const express = require("express");
const app = express();
const server = require("http").createServer(app);

const WebSocketServer = require("ws");
const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
const websocketServer = new WebSocketServer.Server({ server });

require("dotenv").config();
const deepgramApiKey = process.env.DEEPGRAM_API_KEY;

websocketServer.on("connection", (ws) => {
  console.log("new client connected");

  const deepgram = createClient(deepgramApiKey);
  const connection = deepgram.listen.live({
    model: "nova-2",
    smart_format: true,
    encoding: "mulaw",
    sample_rate: 8000,
    channels: 1,
  });

  connection.on(LiveTranscriptionEvents.Open, () => {
    connection.on(LiveTranscriptionEvents.Close, () => {
      console.log("Connection closed.");
    });

    connection.on(LiveTranscriptionEvents.Transcript, (data) => {
      console.log(data.channel.alternatives[0].transcript)
    });

    ws.on("message", (data) => {
      const twilioMessage = JSON.parse(data);
      if (
        twilioMessage["event"] === "connected" ||
        twilioMessage["event"] === "start"
      ) {
        console.log("received a twilio connected or start event");
      }
      if (twilioMessage["event"] === "media") {
        const media = twilioMessage["media"];
        const audio = Buffer.from(media["payload"], "base64");
        connection.send(audio);
      }
    });

    ws.on("close", () => {
      console.log("client has disconnected");
      if (connection) {
        connection.finish();
      }
    });

    ws.onerror = function () {
      console.log("some error occurred");
      connection.finish();
    };
  });
});

app.use(express.static("public"));


app.post("/", (req, res) => {
  res.set("Content-Type", "text/xml");

  res.send(`
    <Response>
      <Start>
        <Stream url="wss://${req.headers.host}/"/>
      </Start>
      <Say>I will stream the next 60 seconds of audio through your websocket</Say>
      <Pause length="60" />
    </Response>
  `);
});

console.log("Listening on Port 8080");
server.listen(8080);