import { output, ProjectConfiguration, readProjectConfiguration, targetToTargetString, Tree, updateProjectConfiguration } from '@nrwl/devkit';
import { EsbuildNodeServerExecutorSchema } from '../../executors/esbuild-node-server/schema';
import { prompt } from 'enquirer';
import { AddCustomServeExecutorSchema } from './schema';

interface NormalizedOptions extends AddCustomServeExecutorSchema {
  target: string;
  buildTarget: string;
}

async function normalizeOptions(projectConfig: ProjectConfiguration, options: AddCustomServeExecutorSchema): Promise<NormalizedOptions> {

  const target = options.target || await prompt<{ target: string }>({
    name: 'target',
    type: 'input',
    message: 'What is the name of the target you want to generate?',
    initial: 'serve'
  }).then(p => p.target);

  const targetString = targetToTargetString({ project: options.project, target });
  console.debug(targetString);
  if (target in projectConfig.targets)
    throw new Error(`target '${targetString}' already exists`);

  const buildTarget = await getBuildTargetFromConfig(projectConfig, options);
  const buildTargetString = await targetToTargetString({ project: options.project, target: buildTarget });
  if (projectConfig.targets[buildTarget].executor !== '@nrwl/esbuild:esbuild')
    output.warn({
      title: `WARNING: target '${buildTargetString}' does not use the '@nrwl/esbuild:esbuild' executor, the generated serve target may not work as expected`
    });

  return {
    ...options,
    target,
    buildTarget
  };
}

export default async function (tree: Tree, options: AddCustomServeExecutorSchema) {
  const projectConfig = readProjectConfiguration(tree, options.project);
  const normalizedOptions = await normalizeOptions(projectConfig, options);

  updateProjectConfiguration(
    tree,
    normalizedOptions.project,
    {
      ...projectConfig,
      targets: {
        ...projectConfig.targets,
        [normalizedOptions.target]: {
          executor: 'custom-plugins:esbuild-node-server',
          options: {
            buildTarget: targetToTargetString({
              project: normalizedOptions.project,
              target: normalizedOptions.buildTarget
            }),
            experimentalNodeResolution: false
          } satisfies EsbuildNodeServerExecutorSchema,
          configurations: {
            production: {
              buildTarget: targetToTargetString({
                project: normalizedOptions.project,
                target: normalizedOptions.buildTarget,
                configuration: 'production'
              })
            }
          } satisfies { [key: string]: Partial<EsbuildNodeServerExecutorSchema> },
          dependsOn: [normalizedOptions.buildTarget]
        }
      }
    }
  );
}

async function getBuildTargetFromConfig(projectConfig: ProjectConfiguration, { buildTarget }: AddCustomServeExecutorSchema) {
  if (buildTarget && buildTarget in projectConfig.targets) {
    return buildTarget;
  }

  const possibleTargets = Object.keys(projectConfig.targets);
  const promptBuildTarget = await prompt<{ buildTarget: string }>({
    name: 'buildTarget',
    message: 'Which build target would you like to use?',
    type: 'select',
    choices: possibleTargets.map(t => ({ name: t, message: `${t} [${projectConfig.targets[t].executor}]` }))
  });

  return promptBuildTarget.buildTarget;
}
