import { ExecutorContext, output, parseTargetString, readTargetOptions, runExecutor, Target } from '@nrwl/devkit';
import { ChildProcess, spawn } from 'child_process';
import { EsbuildNodeServerExecutorSchema } from './schema';
import { EsBuildExecutorOptions } from '@nrwl/esbuild';

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

  const { hasESM } = processBuildTarget(buildTarget, options, context);

  const env = {
    ...process.env
  };
  if (hasESM && options.experimentalNodeResolution) {
    env['NODE_OPTIONS'] = '--experimental-specifier-resolution node  ' + (env['NODE_OPTIONS'] || '');
  }

  let existingCp: ChildProcess | undefined;
  for await (const result of await runExecutor<BuildEvent>(buildTarget, { watch: true }, context)) {
    // wait to close previous running process if exists
    await new Promise<void>(resolve => {
      if (existingCp) {
        existingCp.on('close', () => resolve());
        existingCp.kill();
      }
      else
        resolve()
    });

    if (result.success) {
      const cp = spawn('node', [result.outfile], { env, stdio: 'inherit' });
      // clear the variable in case the process exits early (like with errors)
      cp.on('close', () => existingCp = undefined);
      existingCp = cp;
    }
    yield result;
  }
}

function processBuildTarget(buildTarget: Target, options: EsbuildNodeServerExecutorSchema, context: ExecutorContext) {
  const buildTargetOptions = readTargetOptions(buildTarget, context) as EsBuildExecutorOptions;

  const hasESM = buildTargetOptions.format.includes('esm');

  if (hasESM) {
    const isNotFullyBundled = !buildTargetOptions.bundle || buildTargetOptions.external;
    if (isNotFullyBundled)
      output.warn({
        title: 'WARNING: nodejs requires that relative ESM import statements use file extensions.',
        bodyLines: [
          `If you're using typescript and if any part of your code is not bundled, ensure that your relative imports end with file extensions.`,
          'Not doing so will result in [ERR_MODULE_NOT_FOUND] errors if you execute the built esm application.',
          'You can read more about it here:',
          '  https://nodejs.org/docs/latest-v18.x/api/esm.html#mandatory-file-extensions',
          '  https://www.typescriptlang.org/docs/handbook/esm-node.html',
          '\n',
          `Alternatively, from nodejs12 to nodejs18, we can use the '--experimental-specifier-resolution=node' flag`,
          `This behaviour ${options.experimentalNodeResolution ? 'has been' : 'can be'} enabled by setting 'experimentalNodeResolution: true in the serve target options`,
          '\n'
        ]
      });
  }

  return { hasESM };
}

