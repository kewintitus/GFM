# Git Feature Manager

Git Feature Manager (GFM) is a desktop app for committing and promoting work by feature. A team shares one catalog in the repository. Each commit names a feature, a task, and a subtask. A release manager can then move that feature across DEV, QAS, UAT, and PROD without mixing in unrelated commits.

The app stores nothing of its own. The catalog, the environment branches, and the promotion history live in the git repository the team already shares.

## Screens

| Screen | Who uses it | What it does |
| --- | --- | --- |
| Commit | Contributor | Stages files and commits them against one subtask. |
| Catalog | Contributor | Defines features, tasks, and subtasks. |
| Features | Either | Groups recent commits by the `Feature` trailer. |
| Environments | Either | Names the long-lived branch for DEV, QAS, UAT, and PROD. |
| Promote | Release manager | Plans a promotion and prepares a branch for that feature. |

The role switch at the bottom of the sidebar is local to this machine. Contributor can commit. Release manager can prepare a promotion. Directory sign-in is not part of this version.

## Set up a product repository

Do this once in the repository the team works in, not in the GFM source repository.

1. Install [Git](https://git-scm.com/) and make sure `git` works in a terminal.
2. Open GFM and choose that repository.
3. Open **Environments**. Set the four long-lived branches and save. The defaults are `dev`, `qas`, `uat`, and `main`. Saving writes `gfm/release/environments.json`.
4. Open **Catalog**. Create a feature, then a task under it, then a subtask under that task. Saving writes one file per feature under `gfm/release/features/`, such as `gfm/release/features/F-7C9E2A1B4D.json`. Tasks and subtasks live in that feature file.
5. Commit those two files and push them. Teammates need the same copies. Do not ignore the `gfm` folder.
6. On **Commit**, choose **Install** on the hook row. The hook rejects a commit that has no `Feature`, `Task`, and `Subtask` trailers, including commits made outside GFM. **Remove** deletes only the GFM hook.

New items get a random id such as `F-7C9E2A1B4D`. Older numeric ids such as `F-3` remain valid. Pick items from the catalog. Typed ids are not accepted.

## Commit

Switch the role to **Contributor**.

1. Check out the branch you want to commit on. To start a subtask branch from **Catalog**, leave **Create a branch** checked. The branch name looks like `work/dev/F-7C9E2A1B4D/T-A374407A87/ST-6076324777-aws-init`. The base defaults to the branch you are already on, which is the right choice when a feature file under `gfm/release/features/` is already modified. Choosing a different base while the tree is dirty is refused.
2. On **Commit**, stage the files, choose the feature, task, and subtask, and write a summary of at most 72 characters.
3. Create the commit. The message looks like this:

```text
feat: add refund endpoint

Feature: F-7C9E2A1B4D
Task: T-A374407A87
Subtask: ST-6076324777
```

Those three trailer lines are how Features and Promote tell commits apart. The subject line is only the message.

A task can require one commit type, such as `feat`. The type list on the commit screen follows that.

**Mark completed** can close the subtask, and the task or feature when every child under it is already complete. GFM makes your commit first, then a second commit on the same branch that records the new status in the catalog. A completed subtask no longer appears on the commit screen.

**Push after the commit** pushes the branch after both commits succeed. **Skip hooks** passes `--no-verify` and bypasses the trailer check.

## Promote

Switch the role to **Release manager**. Start from the branch that contains the feature commits, with a clean working tree.

1. Open **Promote**. Choose a feature to include every task and subtask, or clear the ones that should stay behind. Choose the target.
2. **Build plan** lists the commits that would move, oldest first. **Copy hashes** copies their full hashes, separated by spaces, for a manual `git cherry-pick`.
3. **Prepare branch** checks out a new branch named `promote/<base>/<feature id>`. DEV can merge the work branch. QAS, UAT, and PROD cherry-pick that feature only, because a merge would bring every other feature. **Squash into one commit** combines the selected commits.
4. The long-lived branch stays unchanged. Review the prepared branch, then merge it with your usual git process.

A feature with no `Feature` trailer is **Unscoped** and cannot be promoted.

## Follow these rules

- Share `gfm/release/features/` and `gfm/release/environments.json`. They are the team record. Each feature is its own file, so two people can edit different features without a catalog conflict.
- One subtask should have one work branch. The branch name carries the ids so two people can see who owns the work.
- Do not create a branch whose path starts with an existing branch. `dev/feature` cannot exist while a branch named `dev` exists. The `work/` prefix avoids that.
- Keep the hook installed on machines that commit to this repository.
- Prepare a promotion from a clean tree. Commit or remove local changes first.

## Develop GFM

These steps are for changing the app itself.

```powershell
npm install
npm start
npm test
```

`npm start` opens the app in development and reloads as you edit. `npm test` runs the unit tests. `npm run dist:win` builds a Windows installer and a portable exe in `dist/`:

- `Git Feature Manager Setup 0.1.0.exe`
- `Git Feature Manager 0.1.0.exe`

The version in those names comes from `package.json`.

| Path | Role |
| --- | --- |
| `src/main` | Electron process. Git commands and file writes. |
| `src/preload` | Bridge from the window to the main process. |
| `src/renderer` | The screens. |
| `shared` | Catalog, commit messages, promotion rules, and tests. |
| `hooks/commit-msg.disabled` | Hook template copied into a product repository on Install. |
| `gfm/release` | Created in the product repository, not in this one. Features are `gfm/release/features/<id>.json`. |

## License

MIT. See [LICENSE.txt](LICENSE.txt).
