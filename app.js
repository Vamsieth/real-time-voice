const express = require("express");
const app = express();
const server = require("http").createServer(app);

const WebSocketServer = require("ws");
const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
const websocketServer = new WebSocketServer.Server({ server });
require("dotenv").config();

const twilio = require("twilio");
const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const deepgramApiKey = process.env.DEEPGRAM_API_KEY;

const VoiceResponse = twilio.twiml.VoiceResponse;
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const openaiApiKey = process.env.OPENAI_API_KEY;
const client = new twilio.Twilio(accountSid, authToken);
let gpt;
const twiml = new VoiceResponse();
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

    connection.on(LiveTranscriptionEvents.Transcript, async (data) => {
      let dpres = data.channel.alternatives[0].transcript;
      console.log(dpres);

      gpt = dpres
        ? await gptResponse(data.channel.alternatives[0].transcript)
        : null;
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

let systemPrompt = `You're a customer support agent of an Ecommerce business, tone should be empathetic and try resolving the customer issues`;

let gptResponse = async (text) => {
  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: text,
      },
    ],
    temperature: 1,
  });
  let res = response.choices[0].message.content;
  console.log(res);
  return res;
};

function twilioSpeech(req, res) {
  twiml.say(`${gpt}`);

  // twiml.gather({
  //   input: 'speech',
  //   timeout: 3,
  //   action: '/handle-response',
  //   method: 'POST',
  // });
  // twiml.record({
  //   action: '/handle-recording',
  //   transcribe: true,
  //   transcribeCallback: '/transcript',
  // });

  res.type("text/xml");
  res.send(twiml.toString());
}

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

  twiml.gather({
    input: "speech",
    timeout: 3,
    action: "/speech",
    method: "POST",
  });
});

app.post("/speech", twilioSpeech);

console.log("Listening on Port 8080");
server.listen(8080);
