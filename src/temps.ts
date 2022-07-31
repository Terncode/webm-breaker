import path from "path";
import fs from "fs";

const TEMP_FOLDER = "temp";
export function createTemp(name: string) {
    const innerTemp = path.join(process.cwd(), TEMP_FOLDER);
    if (!fs.existsSync(innerTemp)) {
        fs.mkdirSync(innerTemp);
    }
    const p = path.join(process.cwd(), TEMP_FOLDER, name);
    if (!fs.existsSync(p)) {
        fs.mkdirSync(p);
    }
    return p;
}