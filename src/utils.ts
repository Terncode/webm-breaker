import { existsSync } from "fs";
import path from "path";

export function wrap(message:string){
    const quotes = "```";
    return `${quotes}\n${message}${quotes}`;
}

export function uniqueName(originalName: string, dirPath: string) {
    let count = 0;
    let fileName = "";
    let outputPath = "";
    do {
        if (count > 0) {
            if (originalName.includes(".")) {
                const split = originalName.split(".");
                const ex = split.pop();
                split.push(count.toString());
                split.push(ex);
                fileName = split.join(".");
            } else {
                fileName = `${originalName}${count}`;
            }
        }
        outputPath = path.join(dirPath, fileName);
        count++;
    } while (existsSync(outputPath));
    return {
        fileName,
        outputPath
    };
}