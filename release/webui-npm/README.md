# MiniMax Code WebUI package

This package runs the MiniMax Code WebUI and its local runtime on your machine.
It is published to the public npm registry. No GitHub account or personal access
token is required to install it.

```sh
npm install --global @minimax-webui/minimax-code
mcode-webui
```

The server listens on `http://127.0.0.1:2233/`. Set `WEBUI_SERVER_PORT` to
change the port or `MINIMAX_DATA_DIR` to change the local data directory. The
default data directory is `~/.minimax`.

The package requires a supported Node.js version shown in its `engines` field.
