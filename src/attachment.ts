import { Attachment, DMChannel, Message, TextChannel } from "discord.js";
import { createTemp } from "./temps";
import { uniqueName, wrap } from "./utils";
import axios, { AxiosError } from "axios";
import { createWriteStream, promises as fsPromise } from "fs";
import { Stream } from "stream";
import { processVideo, VideoType } from "./processVideo";

const noop = () => { /* void */};

const downloadPath = createTemp("downloads");

enum Status {
    Done,
    Downloading,
    Processing,
    Rendering, 
    Failed
}
interface AttachmentProcessor {
    attachment: Attachment
    getStatus: () => Status,
    cancel: () => void,
    getProgress: () => number,
    getError: () => string | undefined;
    getOutputPath: () => string;
    clear: () => void
}

export async function handleMessage(message: Message) {
    const channel = getChannel(message);
    if (!channel) return;
    if (!message.attachments.size) {
        return channel.send("❗ Missing attachment!");
    }
    let type: VideoType = "bounce";

    if (message.content.includes("bounce_shutter")) {
        type = "bounce_shutter";
    } else if (message.content.includes("shutter")) {
        type = "shutter";
    } else if (message.content.includes("sporadic")) {
        type = "sporadic";
    } else if (message.content.includes("bounce")) {
        type = "bounce";
    }


    const list = new Map<Attachment, AttachmentProcessor>();


    let timeout: NodeJS.Timeout | undefined;
    let lastUpdate = Date.now();
    let messageRef: Message<boolean>;
    const UPDATE_MESSAGE = 1000 * 5; // 5 seconds


    const mapList = (ap: AttachmentProcessor) => {
        const a = ap.attachment;
        let status = "Unknown";

        switch (ap.getStatus()) {
        case Status.Done:
            status = "Done";
            break;
        case Status.Failed:
            status = `Failed: ${ap.getError() || "Unknown"}`;
            break;
        case Status.Processing:
            status = `Processing ${Math.round(ap.getProgress() * 100)}%`;
            break;
        case Status.Rendering:
            status = "Rendering";
            break;
        case Status.Downloading:
            status = "Downloading";
            break;
        }
        return `${a.name}: ${status}`;
    };

    const mapAttachment = () => {
        return `Status:\n${Array.from(list).map((e) => mapList(e[1])).join("\n")}`;
    };

    const cTimeout = () => {
        if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
        }
    };

    const onEnd = async () => {
        cTimeout();
        const aps = Array.from(list).map(e => e[1]);
        const success = aps.filter(e => e.getStatus() === Status.Done);
        const failed = aps.filter(e => e.getStatus() === Status.Failed);
        let successCount = success.length;
        let failedCount = failed.length;

        if (success.length) {

            for (const path of success) {
                try {
                    await channel.send({
                        files: [path.getOutputPath()],
                    });
                } catch (error) {
                    channel.send(`Unable to send ${path.attachment.name} Probably because the output vide exceeded 8MB limit`).catch(noop);
                    successCount--;
                    failedCount++;
                }
                
            }
            channel.send(`Total: ${aps.length}, Success: ${successCount}, Failed: ${failedCount}`).catch(noop);

        } else {
            channel.send("No successful results");
        }

        try {
            if (messageRef.deletable) {
                await messageRef.delete();
            }
        } catch (error) {
            console.error(error);
        }
        for (const ap of aps) {
            ap.clear();
        }
    };

    const onUpdate = () => {
        const edit = () => {
            if(messageRef && messageRef.editable) {
                const ref = messageRef;
                messageRef = undefined;
                ref.edit(wrap(mapAttachment())).then(ref => {
                    messageRef = ref;
                }).catch(e => {
                    messageRef = ref;
                    console.error(e);
                }).finally(() => {
                    lastUpdate = Date.now();
                });
            }
        };

        const result = Array.from(list).find((e) => {
            const status = e[1].getStatus();
            return !!(status === Status.Failed || status === Status.Done);
        });
        if (result) {
            cTimeout();
            edit();
            onEnd();
            return;
        }

        if (!messageRef || !lastUpdate) return;
        const now = Date.now();
        const delta = now - lastUpdate;
        if (delta > UPDATE_MESSAGE) {
            cTimeout();
            edit();
        } else {
            cTimeout();
            timeout = setTimeout(() => {
                onUpdate();
            }, UPDATE_MESSAGE - delta);
        }
    };

    for (const [, attachment] of message.attachments) {
        const obj = processAttachment(attachment, () => {onUpdate();}, type);
        list.set(attachment, obj);
    }

    messageRef = await channel.send(wrap(mapAttachment()));
    lastUpdate = Date.now();
}

function processAttachment(attachment: Attachment, onUpdate: () => void, type: VideoType): AttachmentProcessor {
    let status: Status = Status.Downloading;
    let error: string | undefined;
    let progress = 0;
    let output = "";
    let downloadFilePath = "";
    if (attachment.contentType.startsWith("video")) {
        const { fileName, outputPath} = uniqueName(attachment.name, downloadPath);

        downloadFilePath = outputPath;
        const writer = createWriteStream(outputPath);

        const processFile = async () => {
            const videoLocation = await processVideo(outputPath, fileName, p => {
                progress = p;
                if(p === 1) {
                    status = Status.Rendering;
                }
                onUpdate();
            }, type);
            output = videoLocation;
            status = Status.Done;
            onUpdate();
        };

        axios.get<Stream>(attachment.url, {responseType:"stream"}).then(response => {

            writer.on("finish", () => {
                processFile();
                status = Status.Processing;
                onUpdate();
            });

            writer.on("error", err => {
                status = Status.Failed;
                error = err.message;
                onUpdate();
            });
            response.data.pipe(writer);

        }).catch(e => {
            console.error(e);
            status = Status.Failed;
            if (typeof e === "object") {
                if(e.isAxiosError) {
                    const axiosError = e as AxiosError;
                    error = JSON.stringify(axiosError.response.data, null, 2) || axiosError.message;
                } else {
                    error = e.message || "Request failed error";
                }
            } else {
                error = "Request failed error message";
            }
            onUpdate();
        });
    } else {
        error = "Not a video",
        status = Status.Failed;
    }
    return  {
        attachment,
        getStatus: () => status,
        cancel: () => {
            // Todo implement
        },
        getError: () => error,
        getProgress: () => progress,
        getOutputPath: () => output,
        clear: () => {
            if (output) {
                fsPromise.unlink(output).catch(noop);
            }
            fsPromise.unlink(downloadFilePath).catch(noop);
            output = undefined;
        },
    };
}


function getChannel(message: Message): TextChannel | DMChannel {
    if (!message.guild) return message.channel as DMChannel; // we can send attachments in dm
    const me = message.guild.members.me;
    if (!me) return undefined; // we cannot check permissions
    
    if (!message.channel.isTextBased()) return undefined; // only sending in text channels

    const channel = message.channel as TextChannel;
    const myPermissions = channel.permissionsFor(me);
    if (myPermissions.has("SendMessages") && myPermissions.has("EmbedLinks")) {
        return channel;
    }
    return undefined;
}
