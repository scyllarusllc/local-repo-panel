# My GitHubs

A local dashboard for browsing and running the projects in `~/github`. Search and sort your folders, open app and repository links, and manage development processes from one table.

## Quick start

Requires **Node.js 22+**, npm, and macOS or Linux. Restart also requires `lsof`; project commands may require tools such as Make, Python, or their own dependencies.

```sh
npm ci
npm start
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080). The dashboard listens on loopback only.

To choose a different dashboard port or project directory:

```sh
PORT=8081 PROJECTS_DIR=/path/to/projects npm start
```

## Using the dashboard

The table lists visible, immediate subdirectories of the project directory. Search by name or description, and sort by name, folder modification time, or folder creation time. Dates are filesystem folder timestamps, not Git commit dates. Status refreshes every 10 seconds.

Click **Edit** to configure a project:

| Setting | Purpose | Automatic default |
| --- | --- | --- |
| Start command | Shell command executed in the project folder | `make dev` when the Makefile declares a `dev` target |
| App URL | Link to the running app and port used by Restart | Port from a Makefile `PORT ?=` declaration or local URL |
| Project link | Repository or website link | `package.json` homepage, then Git origin URL |

### Process controls

- **Start** launches the command in a detached child process group. The dashboard removes its own `PORT` and `PROJECTS_DIR` variables from the child environment, allowing each project to use its own defaults. An immediate exit during the first 400 ms is reported with captured output.
- **Stop** sends `SIGTERM` to a process group started by this dashboard and waits up to three seconds. If it remains alive, an error is shown and management is retained for another attempt.
- **Restart** stops the managed process group and terminates TCP listeners on the App URL’s port, including externally started processes. After a two-second grace period it force kills remaining original processes, confirms the port is free, and launches the saved command. The dashboard’s own port is protected.

Restart requires an HTTP(S) App URL using `localhost`, `127.0.0.1`, or `::1`. Check the configured port before restarting: any listener on that port can be terminated.

Managed children can continue running after the dashboard exits. Process ownership is held in memory; after a dashboard restart, use Restart to take over an existing app.

### Status indicators

| Status | Meaning |
| --- | --- |
| Running | The dashboard tracks a live process group |
| Running externally | The configured local IPv4 port accepts TCP connections, without a tracked process group |
| Stopped | Neither condition was detected |

Port detection supports `localhost` and `127.0.0.1` over IPv4. IPv6 and remote URLs remain clickable but are not probed. A reachable port does not prove application health or identify which project owns it; projects sharing a port can show the same status.

## Settings and logs

Local runtime files live in `data/` and are excluded from Git:

- `config.json`: settings for the default `~/github` directory.
- `config-<SHA256>.json`: separate settings for each other resolved absolute project directory.
- `logs/<SHA256>.log`: combined stdout and stderr for the latest launch of each project. Each launch replaces that project's previous log.

Commands execute with your local user permissions. Use the dashboard for trusted local projects.

## Development

```sh
npm run dev        # Watch the Node server
npm run build:css  # Compile Tailwind CSS into public/style.css
npm test           # Run server integration tests
```

Start and dev compile CSS automatically. After editing styles while the dev server is running, rerun `npm run build:css` and refresh the page. Tailwind is compiled locally; the UI does not require a CSS CDN.

## Troubleshooting

- **Dashboard port already in use:** choose another port, for example `PORT=8081 npm start`.
- **Start fails:** check the error message and `data/logs/`, then run the saved command in the project directory to check its dependencies. Set project-specific ports in the project's command or configuration.
- **Restart reports Not found:** restart the dashboard server after backend changes, then refresh the page. Static frontend files can update while an older backend is still running.
- **Stop times out:** inspect the project process or use Restart when a local App URL is configured.
