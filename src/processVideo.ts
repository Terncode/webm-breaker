// based on
// https://github.com/OIRNOIR/WebM-Maker-Thing-Idk

import { exec, ExecException } from "child_process";
import { readdirSync, promises as fsPromise} from "fs";

import path from "path";
import { createTemp } from "./temps";
import { uniqueName } from "./utils";
export type VideoType = "bounce"  | "shutter" |  "sporadic" | "bounce_shutter"

const delta = 2;
const bouncesPerSecond = 1.9;

const outputPath = createTemp("output");

const getFileName = (name: string) => path.basename(name, path.extname(name));


function execPromise(command: string) {
    return new Promise<{stdout: string, stderr: string}>((resolve, reject) => {
        exec(command, (error: ExecException, stdout: string, stderr: string) => {
            if(error) {
                reject(error);
            } else {
                resolve({
                    stderr,
                    stdout
                });
            }
        });
    });
}

export async function processVideo(videoPath: string, fileName: string, onUpdate: ((percentage: number) => void), type: VideoType = "bounce") {
    const videoInfo = await execPromise(`ffprobe -v error -select_streams v -of json -show_entries stream=r_frame_rate,width,height "${videoPath}"`);
    // eslint-disable-next-line prefer-const
    let { streams: [{ width: maxWidth, height: maxHeight, r_frame_rate: framerate }] } = JSON.parse(videoInfo.stdout.trim());
    maxWidth = parseInt(maxWidth, 10);
    maxHeight = parseInt(maxHeight, 10);
    const decimalFramerate = framerate.includes("/") ? Number(framerate.split("/")[0]) / Number(framerate.split("/")[1]) : Number(framerate);

    const r = "render";
    createTemp(r);
    const temp = createTemp(path.join(r, fileName));
    const tempFolder = path.join(temp, "tempFiles");
    const tempAudio = path.join(temp, "tempAudio.webm");
    const tempConcatList = path.join(temp, "tempConcatList.txt");
    const tempFrames = path.join(temp, "tempFrames");
    const tempFrameFiles = path.join(tempFrames, "%d.png");
    const tempResizedFrames = path.join(temp, "tempResizedFrames");

    await fsPromise.mkdir(tempFolder);
    await fsPromise.mkdir(tempFrames);
    await fsPromise.mkdir(tempResizedFrames);

    let audioFlag = true;
    try {
        await execPromise(`ffmpeg -y -i "${videoPath}" -vn -c:a libvorbis "${tempAudio}"`);
    }
    catch {
        audioFlag = false;
    }

    await execPromise(`ffmpeg -y -i "${videoPath}" "${tempFrameFiles}"`);

    const tempFramesFiles = readdirSync(tempFrames);
    const tempFramesFrames = tempFramesFiles
        .filter(f => f.endsWith("png"))
        .map(f => ({ file: f, n: parseInt(getFileName(f), 10) }))
        .sort((a, b) => a.n - b.n);

    let index = 0;
    const lines = [];
    let width = maxWidth;
    let height = maxHeight;
    for (const { file } of tempFramesFrames) {
        let q = 16;
        switch (type) {
        case "bounce":
            height = index === 0 ?
                maxHeight : 
                (Math.floor(Math.abs(Math.cos(index / (decimalFramerate / bouncesPerSecond) * Math.PI) * (maxHeight - delta))) + delta);
            break;
        case "shutter":
            width = index === 0 ?
                maxWidth : (Math.floor(Math.abs(Math.cos(index / (decimalFramerate / bouncesPerSecond) * Math.PI) * (maxWidth - delta))) + delta);
            break;
        case "sporadic":
            q = 1;
            width = index === 0 ? maxWidth : (Math.floor(Math.random() * (maxWidth - delta)) + delta);
            height = index === 0 ? maxHeight : (Math.floor(Math.random() * (maxHeight - delta)) + delta);
            break;
        case "bounce_shutter":
            height = index === 0 
                ? maxHeight
                : (Math.floor(Math.abs(Math.cos(index / (decimalFramerate / bouncesPerSecond) * Math.PI) * (maxHeight - delta))) + delta);
            width = index === 0 
                ? maxWidth 
                : (Math.floor(Math.abs(Math.sin(index / (decimalFramerate / bouncesPerSecond) * Math.PI) * (maxWidth - delta))) + delta);
        }
   
        const cl = `${path.join(tempResizedFrames, `${file}.webm`)}`; 
        await execPromise(`ffmpeg -y -i "${path.join(tempFrames, file)}" -c:v vp8 -b:v ${q}k -crf 10 -vf scale=${width}x${height} -aspect ${width}:${height} -r ${framerate} -f webm "${cl}"`);
        // Tracks the new file for concatenation later.//
        lines.push(`file '${cl}'`);
        index++;
        onUpdate(index / tempFramesFrames.length);
    }

    onUpdate(1);
    await fsPromise.writeFile(tempConcatList, lines.join("\n"));
    let newFileName = "";
    const ex = ".webm"; 
    if (fileName.includes(".")) {
        const split = fileName.split(".");
        split.pop();
        split.push(ex);
        newFileName = split.join(".");
    } else {
        newFileName = `${fileName}${ex}`;
    }
    const out = uniqueName(newFileName, outputPath);


    await execPromise(`ffmpeg -y -f concat -safe 0 -i "${tempConcatList}"${audioFlag ? ` -i "${tempAudio}" ` : " "}-c copy "${out.outputPath}"`);
    
    fsPromise.rm(temp, { recursive: true });

    return out.outputPath;
}

