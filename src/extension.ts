import * as path from 'path'
import * as vscode from 'vscode'

import { API, GitExtension } from './api/git'

function getGitExtension(): API | undefined
{
	const vscodeGit = vscode.extensions.getExtension<GitExtension>("vscode.git")
	const gitExtension = vscodeGit && vscodeGit.exports

	return gitExtension && gitExtension.getAPI(1)
}

async function _instantCommit(...resourceStates: vscode.SourceControlResourceState[])
{
	const git = getGitExtension()
	if (!git)
	{
		vscode.window.showErrorMessage('Unable to load Git Extension.')
		return
	}

	if (git.repositories.length <= 0)
	{
		vscode.window.showErrorMessage('No Git repository found.')
		return
	}

	if (resourceStates.length <= 0)
	{
		vscode.window.showWarningMessage('Nothing to commit.')
		return
	}

	// const selectedRepo = git.repositories.find(repository => {
	// 	const uri = sourceControl._rootUri;
	// 	if (!uri) {
	// 	console.warn("_rootUri not set");
	// 	}
	// 	return repository.rootUri.path === uri.path;
	// });

	// git.repositories.forEach((repository, i) => {
	// 	console.log(i, repository.rootUri.path)
	// })

	// Todo: Support multiple repositories
	const repository = git.repositories[0];

	const stagedFiles = await repository.diffIndexWithHEAD()
	const changedFiles = await repository.diffWithHEAD()

	const fileChanges = []
	for (const resourceState of resourceStates)
	{
		const fullPath = resourceState.resourceUri.path
		const relativePath = path.relative(repository.rootUri.path, fullPath).replace(/\\/g, '/')

		const popChange = (path: string, searchStagedFiles: boolean = true) =>
			{
				if (searchStagedFiles)
				{
					// Pop change from staged files
					for (let i = 0; i < stagedFiles.length; i++)
					{
						const stagedFile = stagedFiles[i]
						if (stagedFile.uri.path === path)
						{
							stagedFiles.splice(i, 1) // Remove from staged files
							return stagedFile
						}
					}
				}

				// Pop change from changed files
				for (let i = 0; i < changedFiles.length; i++)
				{
					const changedFile = changedFiles[i]
					if (changedFile.uri.path === path)
					{
						changedFiles.splice(i, 1) // Remove from staged files
						return changedFile
					}
				}

				return undefined
			}

		fileChanges.push(
			{
				path: fullPath,
				relativePath: relativePath,
				letter: (resourceState as any).letter,
				change: popChange(fullPath, true)
			})
	}

	if (stagedFiles.length > 0)
	{
		vscode.window.showErrorMessage('Please clean up your staged files before instant committing.')
		return
	}

	const generateMessage = (fileChanges: any) =>
		{
			let lines = []
			let commonPath = fileChanges.length >= 1 ? fileChanges[0].relativePath : ''
			let commonLetter = fileChanges.length >= 1 ? fileChanges[0].letter : ''

			const findLongestPathPrefix = (a: string, b: string) =>
				{
					while (a.length > 0 && b.length > 0)
					{
						if (a === './' || b === './')
						{
							return undefined
						}

						if (a === b)
						{
							return a
						}

						if (a.length > b.length)
						{
							a = `${path.dirname(a)}/`
						}
						else // b.length > a.length
						{
							b = `${path.dirname(b)}/`
						}
					}

					return undefined
				}

			const letterToString = (letter: string) =>
				{
					switch (letter)
					{
						case "A": return "Add"
						case "M": return "Update"
						case "R": return "Rename"
						case "D": return "Delete"
						default: return "Update"
					}
				}

			for (const fileChange of fileChanges)
			{
				// Update common path
				if (commonPath && commonPath !== fileChange.path)
				{
					commonPath = findLongestPathPrefix(commonPath, fileChange.relativePath)
				}

				// Update common letter
				if (commonLetter && commonLetter !== fileChange.letter)
				{
					commonLetter = undefined
				}

				lines.push(`${letterToString(fileChange.letter)} ${fileChange.relativePath}`)
			}

			if (fileChanges.length > 1)
			{
				let summary = `${letterToString(commonLetter)} ${fileChanges.length} files`

				if (commonPath)
				{
					summary += ` from ${commonPath}`
				}

				// Prepend summary to lines
				// Add an empty line to separate commit title from commit message
				lines.splice(0, 0, summary, '')
			}

			return lines.join('\n')
		}

	const commitMessage = generateMessage(fileChanges)
	console.log(`New message:\n${commitMessage}`)

	await repository.add(fileChanges.map(fileChange => fileChange.path))
	await repository.commit(commitMessage)

	vscode.window.showInformationMessage(`Instant committed: ${commitMessage.split('\n', 1)[0]}`)
}

export function activate(context: vscode.ExtensionContext)
{
	console.log('Extension "instant-commit" is now active')

	const instantCommit = vscode.commands.registerCommand('extension.instantCommit', _instantCommit)
	context.subscriptions.push(instantCommit)
}
