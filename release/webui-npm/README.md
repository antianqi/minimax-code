# MiniMax Code WebUI package

This package runs the MiniMax Code WebUI and its local runtime on your machine.
It is published to the public npm registry. No GitHub account or personal access
token is required to install it.

```sh
npm install --global @minimax-webui/minimax-code
mcode-webui
```

With npm 12 and later, the modules this package builds have to be allowed
explicitly — npm 12 blocks dependency install scripts unless they are named:

```sh
npm install --global @minimax-webui/minimax-code \
  --allow-scripts=better-sqlite3,bufferutil,node-pty,utf-8-validate
```

Or allow them for every global install:

```sh
npm config set allow-scripts=better-sqlite3,bufferutil,node-pty,utf-8-validate --location=user
```

An install that skipped them leaves `better-sqlite3` without its binding, and
`mcode-webui` then stops at startup and prints the reinstall command instead of
running. npm 11 and earlier print the same warning but still run the scripts.

The server listens on `http://127.0.0.1:2233/`. Set `WEBUI_SERVER_PORT` to
change the port or `MINIMAX_DATA_DIR` to change the local data directory. The
default data directory is `~/.minimax`.

`mcode-webui` opens the page in your default browser once the server is
listening. Set `WEBUI_OPEN_BROWSER=0` to keep it from doing that; with the
variable unset it stays quiet when the command's output is not a terminal, so a
script, a service supervisor or a CI job never takes over the desktop.

The package requires a supported Node.js version shown in its `engines` field.
