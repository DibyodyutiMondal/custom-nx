import { createProjectGraphAsync, ExecutorContext, getDependentPackagesForProject, output, parseTargetString, readTargetOptions, runExecutor, Target, targetToTargetString } from '@nrwl/devkit';
import { EsBuildExecutorOptions } from '@nrwl/esbuild';
import { ChildProcess, spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, rm, symlink } from 'fs/promises';
import { EsbuildNodeServerExecutorSchema } from './schema';
import path = require('path');

// taken from @nrwl/esbuild
interface BuildEvent {
  success: boolean;
  outfile: string;
}


export default async function* esbuildNodeServerExecutor(
  options: EsbuildNodeServerExecutorSchema,
  context: ExecutorContext
) {
  if (!context.projectGraph)
    throw new Error('project graph does not exist, please update nx');

  const buildTarget = parseTargetString(options.buildTarget, context.projectGraph);

  const { hasESM, bundled, external, buildTargetOptions } = processBuildTarget(buildTarget, options, context);

  const env = {
    ...process.env
  };
  if (hasESM && options.experimentalNodeResolution) {
    env['NODE_OPTIONS'] = '--experimental-specifier-resolution node  ' + (env['NODE_OPTIONS'] || '');
  }

  const watchIterator = await runExecutor<BuildEvent>(buildTarget, { watch: true }, context);

  let existingCp: ChildProcess | undefined;[]
  for await (const result of watchIterator) {
    // wait to close previous running process if exists
    await new Promise<void>(resolve => {
      if (existingCp) {
        existingCp.on('close', () => resolve());
        existingCp.kill();
      }
      else
        resolve()
    });

    const depsToWatch = await dependenciesToWatch(context.projectName, bundled, external);
    const nodeModules = path.join(buildTargetOptions.outputPath, 'node_modules');
    if (!existsSync(nodeModules))
      await mkdir(nodeModules);
    for (const dep of depsToWatch) {
      const target: Target = { project: dep.name, target: buildTarget.target };
      const { outputPath } = readTargetOptions<{ outputPath?: string }>(target, context);
      const depTargetString = targetToTargetString(target);

      if (outputPath) {
        const exists = existsSync(outputPath);
        if (exists)
          console.log(`[ ${output.colors.green('serve')} ] import '${dep.importKey}' will be linked to output of '${depTargetString}' in '${outputPath}'`);
        else {
          console.log(`[ ${output.colors.red('serve')} ] import '${dep.importKey}' has no output for '${depTargetString}' in '${outputPath}', please ensure the library was built`);
          throw new Error('executor could not guarantee dependency availability');
        }
        const nodePath = path.join(nodeModules, dep.importKey);
        await rm(nodePath, { force: true, recursive: true });
        await symlink(
          path.join(context.cwd, outputPath),
          path.join(context.cwd, nodePath),
        );
      }
      else {
        console.log(`[ ${output.colors.red('serve')} ] dependency '${depTargetString}' did not specify an outputPath`);
        throw new Error('executor could not guarantee dependency availability');
      }
    }

    // for a blank line
    console.log(' ');

    if (result.success) {
      const cp = spawn('node', ['--inspect', result.outfile], { env, stdio: 'inherit' });
      // clear the variable in case the process exits early (like with errors)
      cp.on('close', () => existingCp = undefined);
      existingCp = cp;
    }
    yield result;
  }
}

function processBuildTarget(buildTarget: Target, options: EsbuildNodeServerExecutorSchema, context: ExecutorContext) {
  const buildTargetOptions = readTargetOptions<EsBuildExecutorOptions>(buildTarget, context);

  const hasESM = buildTargetOptions.format.includes('esm');
  const bundled = buildTargetOptions.bundle;
  const external = buildTargetOptions.external;

  if (hasESM && (!bundled || external)) {
    output.warn({
      title: 'WARNING: nodejs requires that relative ESM import statements use file extensions.',
      bodyLines: [
        `If you're using typescript and some parts of your code is not bundled, ensure that your relative imports end with file extensions.`,
        'Not doing so will result in [ERR_MODULE_NOT_FOUND] errors if you execute the built esm application.',
        'You can read more about it here:',
        '  https://nodejs.org/docs/latest-v18.x/api/esm.html#mandatory-file-extensions',
        '  https://www.typescriptlang.org/docs/handbook/esm-node.html',
        '\n',
        `Alternatively, from nodejs12 to nodejs18, we can use the '--experimental-specifier-resolution=node' flag`,
        `This behaviour ${options.experimentalNodeResolution ? 'has been' : 'can be'} enabled by setting 'experimentalNodeResolution: true' in the serve target options`,
        '\n'
      ]
    });
  }

  return { hasESM, bundled, external, buildTargetOptions };
}

/** if `bundle: true`, consider only those dependency libraries which are specified in 'external'
 * 
 *  if `bundle: false`', consider all dependency libraries 
 * */
async function dependenciesToWatch(project: string, bundled: boolean, external: string[]) {
  const freshGraph = await createProjectGraphAsync();
  const dependencies = getDependentPackagesForProject(freshGraph, project);

  if (bundled)
    if (external)
      return dependencies.workspaceLibraries
        .filter(lib => external.includes(lib.importKey));
    else
      return [];
  else
    return dependencies.workspaceLibraries;
}
