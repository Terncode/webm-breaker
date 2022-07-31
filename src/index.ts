import { Client, IntentsBitField } from "discord.js";
import { handleMessage } from "./attachment";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CONFIG = require("../config.json") as { TOKEN: string, PREFIX: string };


const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent,
    ],
});


client.login(CONFIG.TOKEN).then(() => {
    console.log(`Loggined as ${client.user.tag}(${client.user.id})`);

    client.on("messageCreate", msg => {
        if (msg.author.bot) return; // ignoring bot
        if (!msg.content) return; // ignoring empty messages

        if (msg.content.toLowerCase().startsWith(CONFIG.PREFIX)) { // yes old school command parsing because I am to lazy
            const noPrefix = msg.content.slice(CONFIG.PREFIX.length);
            if(noPrefix === "render" || noPrefix.startsWith("render ")) {
                handleMessage(msg);
            }
        }
    });
});
