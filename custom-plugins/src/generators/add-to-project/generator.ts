import {
  formatFiles, output, ProjectConfiguration, readProjectConfiguration,
  Tree, updateProjectConfiguration,
  targetToTargetString
} from '@nrwl/devkit';
import { AddCustomServeExecutorSchema } from './schema';
import { prompt } from 'enquirer';

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
  console.debug(normalizedOptions)

  updateProjectConfiguration(
    tree,
    normalizedOptions.project,
    {
      ...projectConfig,
      targets: {
        ...projectConfig.targets,
        [normalizedOptions.target]: {
          executor: 'custom-plugin:esbuild-node-server',
          options: {
            buildTarget: targetToTargetString({
              project: normalizedOptions.project,
              target: normalizedOptions.buildTarget
            })
          },
          configurations: {
            production: {
              buildTarget: targetToTargetString({
                project: normalizedOptions.project,
                target: normalizedOptions.buildTarget,
                configuration: 'production'
              })
            }
          }
        }
      }
    }
  );
}

async function getBuildTargetFromConfig(projectConfig: ProjectConfiguration, { buildTarget, project }: AddCustomServeExecutorSchema) {
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
