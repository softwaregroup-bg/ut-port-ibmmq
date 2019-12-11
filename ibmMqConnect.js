const mq = require('ibmmq');
const MQC = mq.MQC;
const {Duplex} = require('readable-stream');
const MQTYPES = {
    [MQC.MQMT_DATAGRAM]: 'notification',
    [MQC.MQMT_REQUEST]: 'request',
    [MQC.MQMT_REPLY]: 'response'
};
const UTTYPES = {
    notification: MQC.MQMT_DATAGRAM,
    request: MQC.MQMT_REQUEST,
    response: MQC.MQMT_REPLY
};

const connect = ({host, port, channel, manager, debug = false}) => new Promise((resolve, reject) => {
    var cno = new mq.MQCNO();
    cno.Options |= MQC.MQCNO_CLIENT_BINDING;
    var cd = new mq.MQCD();
    cd.ConnectionName = host + '(' + port + ')';
    cd.ChannelName = channel;
    cno.ClientConn = cd;
    if (MQC.MQCNO_CURRENT_VERSION >= 7) cno.ApplName = 'ut-port-ibmmq';
    mq.setTuningParameters({
        syncMQICompat: true,
        debugLog: debug
    });
    mq.Connx(manager, cno, (err, conn) => {
        err ? reject(err) : resolve(conn);
    });
});

const openQueue = (connection, {name, type}) => new Promise((resolve, reject) => {
    var od = new mq.MQOD();
    od.ObjectName = name;
    od.ObjectType = MQC.MQOT_Q;
    mq.Open(
        connection,
        od,
        type === 'in' ? MQC.MQOO_INPUT_AS_Q_DEF : MQC.MQOO_OUTPUT,
        (err, queue) => err ? reject(err) : resolve(queue)
    );
});

const CONNECTION = Symbol('connection');
const SEND = Symbol('send queue');
const RECEIVE = Symbol('receive queue');
const RECEIVENAME = Symbol('receive queue name');

class IbmMqStream extends Duplex {
    constructor({send, receive, ...connection}, log, streamOptions) {
        super({readableObjectMode: true, writableObjectMode: true, ...streamOptions});
        this[RECEIVENAME] = receive;
        this.remoteAddress = connection.host;
        this.remotePort = connection.port;

        connect(connection)
            .then(async conn => {
                this[CONNECTION] = conn;
                this[SEND] = await openQueue(conn, {name: send, type: 'out'});
                this[RECEIVE] = await openQueue(conn, {name: receive, type: 'in'});
                this.emit('connect');
                return conn;
            })
            .catch(error => {
                this.destroy(error);
            });
    }

    _destroy(error, callback) {
        const promises = [];
        const connection = this[CONNECTION];
        const close = symbol => {
            if (connection && this[symbol]) {
                promises.push(new Promise((resolve, reject) => {
                    const queue = this[symbol];
                    delete this[symbol];
                    mq.Close(queue, 0, err => err ? reject(err) : resolve());
                }));
            } else {
                delete this[symbol];
            }
        };
        close(SEND);
        close(RECEIVE);
        promises.push(new Promise((resolve, reject) => {
            delete this[CONNECTION];
            mq.Disc(connection, err => err ? reject(err) : resolve());
        }));
        Promise.all(promises)
            .then(() => callback(error))
            .catch(err => callback(error || err));
    }

    _write([msg, $meta], encoding, callback) {
        const descriptor = new mq.MQMD();
        const options = new mq.MQPMO();
        if ($meta.trace) {
            options.Options = MQC.MQPMO_NO_SYNCPOINT | MQC.MQPMO_NEW_MSG_ID;
            descriptor.CorrelId.write($meta.trace, 0, 'hex');
        } else {
            options.Options = MQC.MQPMO_NO_SYNCPOINT | MQC.MQPMO_NEW_MSG_ID | MQC.MQPMO_NEW_CORREL_ID;
        }
        descriptor.MsgType = UTTYPES[$meta.mtid];
        if ($meta.mtid === 'request') descriptor.ReplyToQ = this[RECEIVENAME];
        mq.Put(this[SEND], descriptor, options, msg, err => {
            callback(err);
        });
    }

    _read(size) {
        const descriptor = new mq.MQMD();
        const options = new mq.MQGMO();
        Object.assign(options, {
            Options: MQC.MQGMO_NO_SYNCPOINT | MQC.MQGMO_NO_WAIT | MQC.MQGMO_CONVERT | MQC.MQGMO_FAIL_IF_QUIESCING,
            MatchOptions: MQC.MQMO_NONE,
            WaitInterval: MQC.MQWI_UNLIMITED
        });
        mq.Get(this[RECEIVE], descriptor, options, (err, hObj, gmo, md, buf, hConn) => {
            if (err) {
                // TODO handle non fatal errors
                this.destroy(err);
            } else {
                this.push([md.Format === 'MQSTR' ? buf.toString() : buf, {
                    id: md.MsgId.toString('hex'),
                    trace: md.CorrelId.toString('hex'),
                    mtid: md.CorrelId.find(Boolean) ? 'response' : (MQTYPES[md.MsgType] || 'error')
                }]);
            }
        });
    }

    _final(cb) {
        this.destroy(undefined, cb);
    }

    unref() {}
}

module.exports = log => ({
    connect: config => new IbmMqStream(config, log)
});
