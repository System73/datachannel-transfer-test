# System73® DataChannel Transfer Test

This is a test &amp; benchmark for WebRTC DataChannel transfer speed.

This is a fork of [WebRTC datatransfer sample](https://github.com/webrtc/samples).

See [LICENSE](./LICENSE) for license terms and conditions.

---

# Installation and Setup Instructions #

## Signal Server setup ##

The Signal Server can be found inside the "signalserver" folder.

You need to install "Node.js" to run the server.
For Ubuntu:

```
sudo apt install nodejs
```

Go inside the "signalserver" folder.

You need to install the Node.js dependencies inside the "signalserver" folder:
For Ubuntu:

```
npm install
```

To start the Signal Server, run:

```
npm start
```

Data transfer test clients can access the Signal Server like this:

```
ws://x.x.x.x:8000
```

Fill **x.x.x.x** with the machine's IP address. Port is **8000** by default.

Hit Ctrl-C to interrupt the script and stop the Signal Server.

## Web client setup ##

The web client can be found inside the "webclient" folder.

You need to install the Node.js dependencies inside the "webclient" folder:

```
npm install
```

To start serving the web client, run:

```
npm start
```

To access the web client, point the web browser to an URL like this:

```
http://x.x.x.x:8080
```

Fill **x.x.x.x** with the machine's IP address. Port is **8080** by default.

Hit Ctrl-C to interrupt the script and stop serving the web client.
