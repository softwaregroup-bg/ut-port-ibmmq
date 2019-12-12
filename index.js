const uuid = require('uuid/v1');
const TcpPort = require('ut-port-tcp');
const ibmMqConnect = require('./ibmMqConnect');

module.exports = function(...params) {
    return class IbmMqPort extends TcpPort(...params) {
        get defaults() {
            return function defaults() { // return function, as we need to access port.log
                const port = this;
                return {
                    socketTimeOut: 0,
                    maxReceiveBuffer: -1,
                    connection: {},
                    client: ibmMqConnect(this.log),
                    format: {
                        codec: function({prefix, hook}) {
                            return {
                                encode: (object, $meta, context, log) => {
                                    if ($meta.mtid === 'request') {
                                        const trace = Buffer.alloc(24, (prefix || '').padEnd(24));
                                        uuid({}, trace.slice(8));
                                        $meta.trace = trace.toString('hex');
                                    };
                                    const message = [object, {trace: $meta.trace, mtid: $meta.mtid}];
                                    if (log && log.trace) {
                                        log.trace({
                                            $meta: {mtid: 'frame', method: 'ibmmq.encode'},
                                            message,
                                            log: context && context.session && context.session.log
                                        });
                                    }
                                    return message;
                                },
                                decode: (message, $meta, context, log) => {
                                    if (log && log.trace) {
                                        log.trace({
                                            $meta: {mtid: 'frame', method: 'ibmmq.decode'},
                                            message,
                                            log: context && context.session && context.session.log
                                        });
                                    }
                                    const [msg, {mtid, trace}] = message;
                                    $meta.mtid = mtid;
                                    $meta.trace = trace;
                                    $meta.method = port.config.id + 'In.message';
                                    return msg;
                                }
                            };
                        },
                        prefix: 'ut'
                    }
                };
            };
        }
    };
};
