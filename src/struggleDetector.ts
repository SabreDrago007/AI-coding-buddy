import * as vscode from "vscode";
import { spawn } from "child_process";
import * as path from "path";

export interface BehaviorFeatures {
    idle_seconds: number;
    errors: number;
    failed_runs: number;
    deletions: number;
    rapid_edits: number;
}

export class StruggleDetector {

    private features: BehaviorFeatures = {
        idle_seconds: 0,
        errors: 0,
        failed_runs: 0,
        deletions: 0,
        rapid_edits: 0
    };

    private lastEditTime: number = Date.now();

    private idleTimer: NodeJS.Timeout;

    private knownErrors: Set<string> = new Set();


    constructor() {

        this.idleTimer = setInterval(() => {

            this.features.idle_seconds =
                Math.floor(
                    (Date.now() - this.lastEditTime) / 1000
                );

        }, 1000);
    }


    recordEdit(
        deletedCharacters: number = 0
    ): void {

        const now = Date.now();

        const timeSinceLastEdit =
            now - this.lastEditTime;

        this.lastEditTime = now;

        this.features.idle_seconds = 0;


        if (deletedCharacters > 0) {

            this.features.deletions +=
                deletedCharacters;
        }


        if (timeSinceLastEdit < 1000) {

            this.features.rapid_edits++;
        }
    }


    recordError(
        errorKey?: string
    ): void {

        if (errorKey) {

            if (
                this.knownErrors.has(
                    errorKey
                )
            ) {

                return;
            }

            this.knownErrors.add(
                errorKey
            );
        }

        this.features.errors++;

        console.log(
            `AI Coding Buddy: New error detected. Total errors: ${this.features.errors}`
        );
    }


    recordFailedRun(): void {

        this.features.failed_runs++;

        console.log(
            `AI Coding Buddy: Failed run detected. Total failed runs: ${this.features.failed_runs}`
        );
    }


    getFeatures(): BehaviorFeatures {

        return {
            ...this.features
        };
    }


    async predictLevel(): Promise<number> {

        return new Promise(
            (resolve) => {

                const extension =
                    vscode.extensions.all.find(
                        ext =>
                            ext.packageJSON.name ===
                            "ai-coding-buddy"
                    );


                if (!extension) {

                    console.error(
                        "AI Coding Buddy extension not found."
                    );

                    resolve(1);

                    return;
                }


                const scriptPath =
                    path.join(
                        extension.extensionPath,
                        "ml",
                        "predict.py"
                    );


                const python =
                    spawn(
                        "py",
                        [scriptPath]
                    );


                let output = "";


                python.stdout.on(
                    "data",
                    (
                        data: Buffer
                    ) => {

                        output +=
                            data.toString();
                    }
                );


                python.stderr.on(
                    "data",
                    (
                        data: Buffer
                    ) => {

                        console.error(
                            "Python error:",
                            data.toString()
                        );
                    }
                );


                python.on(
                    "error",
                    (error) => {

                        console.error(
                            "Failed to start Python:",
                            error
                        );

                        resolve(1);
                    }
                );


                python.on(
                    "close",
                    () => {

                        const prediction =
                            parseInt(
                                output.trim()
                            );


                        if (
                            prediction === 1 ||
                            prediction === 2 ||
                            prediction === 3
                        ) {

                            resolve(
                                prediction
                            );

                        } else {

                            console.error(
                                "Invalid Random Forest prediction:",
                                output
                            );

                            resolve(1);
                        }
                    }
                );


                python.stdin.write(
                    JSON.stringify(
                        this.features
                    )
                );


                python.stdin.end();
            }
        );
    }


    reset(): void {

        this.features = {
            idle_seconds: 0,
            errors: 0,
            failed_runs: 0,
            deletions: 0,
            rapid_edits: 0
        };

        this.knownErrors.clear();

        this.lastEditTime =
            Date.now();
    }


    dispose(): void {

        clearInterval(
            this.idleTimer
        );
    }
}