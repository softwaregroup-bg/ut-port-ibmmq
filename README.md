# **IBM MQ Port:** `ut-port-mail`

The IBM MQ port establishes a connection and then opens
one or two queues for sending and receiving messages.

The port's namespace can be used to execute requests,
by using the `utMethod('namespace.method')(params)`.

Incoming requests will be dispatched as method calls
using namespace based on port's namespace with added suffix `In`.

Implementations must define the `send` and `receive`
handlers, so that messages can be serialized when
sending and parsed when receiving.

The usual way to do this within UT implementations is:

```js
module.exports = (...params) =>
    class ibmPort extends require('ut-port-ibmmq')(...params) {
        get defaults() {
            return {
                namespace: '...'
            };
        }
        get handlers() {
            return {
                send: (params, {mtid, method}) => {
                    // return string or buffer, based on the passed method parameters,
                    // method name and method type
                },
                receive: async(payload, {mtid, method}) => {
                    // parse the payload, based on received method name and type
                    // return the parsed data as object
                }
            };
        }
    };
```

## configuration

The port expects the following configuration properties:

```yaml
namespace: namespace to use in utMethod
connection:
    host: IBM MQ host
    port: IBM MQ port
    manager: IBM MQ queue manager
    channel: IBM MQ channel
    send: name of send queue
    receive: name of receive queue
    debug: (boolean) show extra debug information from ibmmq module
```
