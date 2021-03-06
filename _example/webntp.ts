module WebNTP {

    export interface Response {
        id: string;
        it: number; // Initiate Time
        st: number; // Send Time
        leap: number;
        next: number;
        step: number;
    }

    export interface Result {
        delay: number;
        offset: number;
    }

    interface Request {
        resolve: (r: Result) => void;
        reject: (reason) => void;
    }

    class Connection {
        url: string;
        connection: WebSocket;
        requests: Request[] = [];

        constructor(url: string) {
            this.url = url;
        }

        open(): Promise<WebSocket> {
            return new Promise<WebSocket>((resolve, reject) => {
                const conn = new WebSocket(this.url, ["webntp.shogo82148.com"]);
                this.connection = conn;
                conn.addEventListener("open", ev => {
                    resolve(conn);
                });
                conn.addEventListener("message", ev => {
                    this.onmessage(conn, ev);
                });
                conn.addEventListener("error", ev => {
                    this.onerror(conn, ev);
                });
                conn.addEventListener("close", ev => {
                    this.onclose(conn, ev);
                });
            });
        }

        do_get(): void {
            if (this.requests.length === 0) {
                // nothing to do.
                return;
            }

            let promise: Promise<WebSocket>;
            if (this.connection) {
                promise = Promise.resolve(this.connection);
            } else {
                promise = this.open();
            }

            promise.then(conn => {
                const now = Date.now()/1000;
                conn.send(now);
            }).catch(reason => {
                if (this.requests.length > 0) {
                    this.requests.shift().reject(reason);
                }
                this.connection = null;
                this.do_get();
            });
        }

        onmessage(conn: WebSocket, ev: MessageEvent) {
            const now = Date.now()/1000;
            const res: Response = JSON.parse(ev.data);
            const delay = now - res.it;
            const offset = res.st - res.it - delay/2;
            const result: Result = {
                delay: delay,
                offset: offset
            };
            if (this.requests.length > 0) {
                this.requests.shift().resolve(result);
            }
            this.do_get();
        }

        onerror(conn: WebSocket, ev: Event) {
            if (this.requests.length > 0) {
                this.requests.shift().reject(ev);
            }
        }

        onclose(conn: WebSocket, ev: Event) {
            this.connection = null;
            this.do_get();
        }

        public get(): Promise<Result> {
            return new Promise<Result>((resolve, reject) => {
                this.requests.push({
                    resolve: resolve,
                    reject: reject
                });
                if (this.requests.length === 1) {
                    this.do_get();
                }
            });
        }
    }

    export class Client {
        // connection pool
        private pool = new Map<string,Connection>();

        // get_connection from the pool
        private get_connection(url : string): Connection {
            if (this.pool.has(url)) {
                // reuse connection
                return this.pool.get(url);
            }
            // create new connection
            const c = new Connection(url);
            this.pool.set(url, c);
            return c;
        }

        get(url : string): Promise<Result> {
            return this.get_connection(url).get();
        }

        get_multi(url: string, samples: number): Promise<Result> {
            if (samples === 0) {
                return Promise.resolve({
                    delay: 0,
                    offset: 0
                });
            }

            let promise: Promise<Result[]> = Promise.resolve([]);
            for(let i = 0; i < samples; i++) {
                promise = promise.then(results => {
                    return this.get(url).then(result => {
                        results.push(result);
                        return results;
                    });
                });
            }
            return promise.then(results => {
                // get min delay.
                let min = results[0].delay;
                for (let result of results) {
                    if (result.delay < min) {
                        min = result.delay;
                    }
                }

                // calulate the avarage.
                let delay = 0;
                let offset = 0;
                let count = 0;
                for (let result of results) {
                    if (result.delay > min*2) {
                        // this sample may be re-sent. ignore it.
                        continue;
                    }
                    delay += result.delay;
                    offset += result.offset;
                    count++;
                }

                return {
                    delay: delay/count,
                    offset: offset/count
                };
            });
        }
    }
}
