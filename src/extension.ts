import * as path from 'path'
import * as vscode from 'vscode'

import { API as GitAPI, Change as GitChange, GitExtension, Repository as GitRepository, Status as GitStatus } from './api/git'


function getGitExtension(): GitAPI | undefined
{
	const vscodeGit = vscode.extensions.getExtension<GitExtension>("vscode.git")
	const gitExtension = vscodeGit && vscodeGit.exports

	const git = gitExtension && gitExtension.getAPI(1)
	if (!git)
	{
		vscode.window.showErrorMessage('Unable to load Git Extension.')
		return
	}

	return git
}

function getGitRepository(): GitRepository | undefined
{
	const git = getGitExtension()
	if (!git)
	{
		return
	}

	if (git.repositories.length <= 0)
	{
		vscode.window.showErrorMessage('No Git repository found.')
		return
	}

	return git.repositories[0]
}

class FileChange
{
	path: string
	relativePath: string
	status: GitStatus | undefined
	change: GitChange | undefined

	constructor(change: GitChange, rootPath: string)
	constructor(path: string, rootPath: string, status?: GitStatus)
	constructor(change: string | GitChange, rootPath: string, status?: GitStatus)
	{
		if (typeof change === 'string')
		{
			this.path = change
			this.status = status
		}
		else
		{
			this.path = change.uri.path
			this.status = change.status
			this.change = change
		}

		this.relativePath = path.relative(rootPath, this.path).replace(/\\/g, '/')
	}
}


function generateMessage(fileChanges: FileChange[])
{
	let lines = []
	let commonPath = fileChanges.length >= 1 ? fileChanges[0].relativePath : undefined
	let commonStatus = fileChanges.length >= 1 ? fileChanges[0].status : undefined

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

	const statusToString = (status: GitStatus | undefined) =>
		{
			switch (status)
			{
				case GitStatus.INDEX_ADDED: return 'Add'
				case GitStatus.INDEX_DELETED: return 'Delete'
				case GitStatus.INDEX_RENAMED: return 'Rename'
				case GitStatus.INDEX_COPIED: return 'Copy'
				default: return 'Update'
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
		if (commonStatus && commonStatus !== fileChange.status)
		{
			commonStatus = undefined
		}

		lines.push(`${statusToString(fileChange.status)} ${fileChange.relativePath}`)
	}

	if (fileChanges.length > 1)
	{
		let summary = `${statusToString(commonStatus)} ${fileChanges.length} files`

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

async function instantCommit(repository: GitRepository, fileChanges: FileChange[])
{
	const commitMessage = generateMessage(fileChanges)
	console.log(`New message:\n${commitMessage}`)

	await repository.add(fileChanges.map(fileChange => fileChange.path))
	await repository.commit(commitMessage)

	vscode.window.showInformationMessage(`Instant committed: ${commitMessage.split('\n', 1)[0]}`)
}

async function _instantCommitStates(...resourceStates: vscode.SourceControlResourceState[])
{
	// Todo: Support multiple repositories
	const repository = getGitRepository()
	if (!repository)
	{
		return
	}

	const stagedFiles = await repository.diffIndexWithHEAD()
	const changedFiles = await repository.diffWithHEAD()

	const fileChanges: FileChange[] = []
	for (const resourceState of resourceStates)
	{
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

		const fullPath = resourceState.resourceUri.path
		const change = popChange(fullPath, true)
		if (change)
		{
			fileChanges.push(new FileChange(change, repository.rootUri.path))
		}
		else
		{
			const letterToStatus = (letter: string) =>
				{
					switch (letter)
					{
						case 'A': return GitStatus.INDEX_ADDED
						case 'M': return GitStatus.INDEX_MODIFIED
						case 'D': return GitStatus.INDEX_DELETED
						case 'R': return GitStatus.INDEX_RENAMED
						case 'C': return GitStatus.INDEX_COPIED
						default: return undefined
					}
				}

			fileChanges.push(new FileChange(fullPath, repository.rootUri.path, letterToStatus((resourceState as any).letter)))
		}
	}

	if (fileChanges.length <= 0)
	{
		vscode.window.showErrorMessage('Please select one or more files to instant commit.')
		return
	}

	if (stagedFiles.length > 0)
	{
		vscode.window.showErrorMessage('Please clean up your staged files before instant committing.')
		return
	}

	instantCommit(repository, fileChanges)
}

export function activate(context: vscode.ExtensionContext)
{
	console.log('Extension "instant-commit" is now active')

	const instantCommitStates = vscode.commands.registerCommand('extension.instantCommitStates', _instantCommitStates)
	context.subscriptions.push(instantCommitStates)
}
