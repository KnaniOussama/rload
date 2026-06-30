// Minimal, fast HTTP target server for benchmarking load testers.
// Responds immediately with a small fixed body so the bottleneck is the
// load generator, not the server. Run: node bench/server.js [port]
const http = require("http");

const PORT = Number(process.argv[2] || 8080);
const BODY = Buffer.from("hello from bench server\n");

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "content-type": "text/plain",
    "content-length": BODY.length,
  });
  res.end(BODY);
});

// Allow many concurrent sockets without artificial limits.
server.maxConnections = 100000;
server.keepAliveTimeout = 60000;

server.listen(PORT, () => {
  console.log(`bench server listening on http://127.0.0.1:${PORT}/`);
});
