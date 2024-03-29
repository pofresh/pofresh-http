const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const bodyParser = require('body-parser');
const methodOverride = require('method-override');
const compression = require('compression');
const Filter = require('../../index');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8087;

const defaultLogger = () => ({
    debug: console.log,
    info: console.log,
    warn: console.warn,
    error: console.error
});

class Http {
    constructor(app, opts) {
        opts = opts || {};
        this.app = app;
        this.http = express();
        this.host = opts.host || DEFAULT_HOST;
        this.port = opts.port || DEFAULT_PORT;

        // 通过nginx获取真实ip
        this.http.enable('trust proxy');

        if (!!opts.isCluster) {
            const serverId = app.getServerId();
            const params = serverId.split('-');
            const idx = parseInt(params[params.length - 1], 10);
            if (/\d+\+\+/.test(this.port)) {
                this.port = parseInt(this.port.substr(0, this.port.length - 2), 10);
            } else {
                assert.ok(false, 'http cluster expect http port format like "3000++"');
            }

            this.port = this.port + idx;
        }

        this.useSSL = !!opts.useSSL;
        this.sslOpts = {};
        if (this.useSSL) {
            this.sslOpts.key = fs.readFileSync(path.join(app.getBase(), opts.keyFile));
            this.sslOpts.cert = fs.readFileSync(path.join(app.getBase(), opts.certFile));
        }

        this.logger = opts.logger || defaultLogger();

        this.http.set('port', this.port);

        // body数据解析
        this.http.use(bodyParser.urlencoded({extended: true}));
        this.http.use(bodyParser.json());
        this.http.use(bodyParser.text({type: 'text/xml'}));

        // http方法扩展
        this.http.use(methodOverride());

        // 压缩
        this.http.use(compression());

        this.beforeFilters = Filter.beforeFilters;
        this.afterFilters = Filter.afterFilters;
        this.server = null;
    }


    loadRoutes() {
        this.http.get('/', (req, res) => {
            res.send('http server ok!');
        });

        const routePath = path.join(this.app.getBase(), 'app/servers', this.app.getServerType(), 'routers');
        assert.ok(fs.existsSync(routePath), `Cannot find route path: ${routePath}`);

        fs.readdirSync(routePath).forEach((fileName) => {
            // filePath+"/"+filename不能用/直接连接，Unix系统是”/“，Windows系统是”\“
            const fullFilePath = path.join(routePath, fileName);
            if (/.js$/.test(fileName)) {
                this.logger.info('load router file: ', fileName);
                let route = require(fullFilePath)(this.app, express, this);
                if (route) {
                    this.http.use('/', route);
                }
            }
        });
    }

    start(cb) {
        this.beforeFilters.forEach((elem) => {
            this.http.use(elem);
        });

        this.loadRoutes();

        this.afterFilters.forEach((elem) => {
            this.http.use(elem);
        });

        if (this.useSSL) {
            this.server = https.createServer(this.sslOpts, this.http).listen(this.port, this.host, () => {
                this.logger.info('Http start', this.app.getServerId(), `url: https://${this.host}:${this.port}`);
                this.logger.info('Http start success');
                // 单进程下不阻塞进程，继续处理新的请求
                process.nextTick(cb);
            });
        } else {
            this.server = http.createServer(this.http).listen(this.port, this.host, () => {
                this.logger.info('Http start', this.app.getServerId(), `port: http://${this.host}:${this.port}`);
                this.logger.info('Http start success');
                // 单进程下不阻塞进程，继续处理新的请求
                process.nextTick(cb);
            });
        }
    }

    afterStart(cb) {
        // this.logger.info('Http afterStart');
        // 单进程下不阻塞进程，继续处理新的请求
        process.nextTick(cb);
    }

    stop(force, cb) {
        this.server.close(() => {
            // this.logger.info('Http stop', force);
            cb();
        });
    }
}

module.exports = (app, opts) => new Http(app, opts);
