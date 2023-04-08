var Service, Characteristic;
const packageJson = require("./package.json");
const request = require("request");
const jp = require("jsonpath");

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory(
        "homebridge-garage-door-shelly1",
        "GarageDoorOpener",
        GarageDoorOpener
    );
};

function GarageDoorOpener(log, config) {
    this.log = log;
    this.config = config;

    this.name = config.name;
    
    this.header = config.header;

    this.openURL = config.openURL;
    this.closeURL = config.closeURL;
    
    this.openBody = confi.openBody;
    this.closeBody = confi.closeBody;
    this.statusBody = confi.statusBody;

    this.openTime = config.openTime || 10;
    this.closeTime = config.closeTime || 10;

    this.switchOff = config.switchOff || false;
    this.switchOffDelay = config.switchOffDelay || 2;

    this.autoLock = config.autoLock || false;
    this.autoLockDelay = config.autoLockDelay || 20;

    this.manufacturer = config.manufacturer || packageJson.author.name;
    this.serial = config.serial || packageJson.version;
    this.model = config.model || packageJson.name;
    this.firmware = config.firmware || packageJson.version;

    this.username = config.username || null;
    this.password = config.password || null;
    this.timeout = config.timeout || 3000;

    this.http_method = config.http_method || "GET";

    this.polling = config.polling || false;
    this.pollInterval = config.pollInterval || 120;

    this.statusURL = config.statusURL;
    this.statusKey = config.statusKey || "$.inputs[0].input";

    this.statusValueOpen = config.statusValueOpen || "0";
    this.statusValueClosed = config.statusValueClosed || "1";
    this.statusValueOpening = config.statusValueOpening || "2";
    this.statusValueClosing = config.statusValueClosing || "3";

    if (this.username != null && this.password != null) {
        this.auth = {
            user: this.username,
            pass: this.password,
        };
    }

    this.service = new Service.GarageDoorOpener(this.name);
}

GarageDoorOpener.prototype = {
    identify: function(callback) {
        this.log("Identify requested!");
        callback();
    },

    _httpRequest: function(url, headers, body, method, callback) {
        request({
                url: url,
                headers: headers,
                body: body,
                method: this.http_method,
                timeout: this.timeout,
                rejectUnauthorized: false,
                auth: this.auth,
            },
            function(error, response, body) {
                callback(error, response, body);
            }
        );
    },

    _getStatus: function(callback) {
        var url = this.statusURL;
		var body = this.statusBody;
		var headers = this.header;

        if (this.config.debug) {
            this.log.debug("Getting status: %s", url);
        }

        this._httpRequest(
            url,
            headers,
            body,
            this.http_method,
            function(error, response, responseBody) {
                if (error) {
                    this.log.error("Error getting status: %s", error.message);
                    this.service
                        .getCharacteristic(Characteristic.CurrentDoorState)
                        .updateValue(new Error("Polling failed"));
                    callback(error);
                } else {
                    let statusValue = 0;

                    if (this.statusKey) {
                        var originalStatusValue = jp
                            .query(
                                typeof responseBody === "string" ?
                                JSON.parse(responseBody) :
                                responseBody,
                                this.statusKey,
                                1
                            )
                            .pop();

                        if (new RegExp(this.statusValueOpen).test(originalStatusValue)) {
                            statusValue = 0;
                        } else if (
                            new RegExp(this.statusValueClosed).test(originalStatusValue)
                        ) {
                            statusValue = 1;
                        } else if (
                            new RegExp(this.statusValueOpening).test(originalStatusValue)
                        ) {
                            statusValue = 2;
                        } else if (
                            new RegExp(this.statusValueClosing).test(originalStatusValue)
                        ) {
                            statusValue = 3;
                        }

                        if (this.config.debug) {
                            this.log.debug(
                                "Transformed status value from %s to %s (%s)",
                                originalStatusValue,
                                statusValue,
                                this.statusKey
                            );
                        }
                    } else {
                        statusValue = responseBody;
                    }
                    this.service
                        .getCharacteristic(Characteristic.CurrentDoorState)
                        .updateValue(statusValue);
                    this.service
                        .getCharacteristic(Characteristic.TargetDoorState)
                        .updateValue(statusValue);

                    if (this.config.debug) {
                        this.log.debug("Updated door state to: %s", statusValue);
                    }

                    callback();
                }
            }.bind(this)
        );
    },

    setTargetDoorState: function(value, callback) {
        var url;

        this.log.debug("Setting targetDoorState to %s", value);

        if (value === 1) {
            url = this.closeURL;
            body = this.closeBody;
            headers = this.header;
        } else {
            url = this.openURL;
            body = this.openBody;
            headers = this.header;
        }

        this._httpRequest(
            url,
            headers,
            body,
            this.http_method,
            function(error, response, responseBody) {
                if (error) {
                    this.log.warn("Error setting targetDoorState: %s", error.message);
                    callback(error);
                } else {
                    if (value === 1) {
                        this.log("Started closing");
                        this.simulateClose();
                    } else {
                        this.log("Started opening");
                        if (this.switchOff) {
                            this.switchOffFunction();
                        }
                        if (this.autoLock) {
                            this.autoLockFunction();
                        }
                        this.simulateOpen();
                    }
                    callback();
                }
            }.bind(this)
        );
    },

    simulateOpen: function() {
        this.service
            .getCharacteristic(Characteristic.CurrentDoorState)
            .updateValue(2);
        setTimeout(() => {
            this.service
                .getCharacteristic(Characteristic.CurrentDoorState)
                .updateValue(0);
            this.log("Finished opening");
        }, this.openTime * 1000);
    },

    simulateClose: function() {
        this.service
            .getCharacteristic(Characteristic.CurrentDoorState)
            .updateValue(3);
        setTimeout(() => {
            this.service
                .getCharacteristic(Characteristic.CurrentDoorState)
                .updateValue(1);
            this.log("Finished closing");
        }, this.closeTime * 1000);
    },

    autoLockFunction: function() {
        this.log("Waiting %s seconds for autolock", this.autoLockDelay);
        setTimeout(() => {
            this.service.setCharacteristic(Characteristic.TargetDoorState, 1);
            this.log("Autolocking...");
        }, this.autoLockDelay * 1000);
    },

    switchOffFunction: function() {
        this.log("Waiting %s seconds for switch off", this.switchOffDelay);
        setTimeout(() => {
            this.log("SwitchOff...");
            this._httpRequest(
                this.closeURL,
                this.header,
                this.closeBody,
                this.http_method,
                function(error, response, responseBody) {}.bind(this)
            );
        }, this.switchOffDelay * 1000);
    },

    getServices: function() {
        this.informationService = new Service.AccessoryInformation();

        this.informationService
            .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
            .setCharacteristic(Characteristic.Model, this.model)
            .setCharacteristic(Characteristic.SerialNumber, this.serial)
            .setCharacteristic(Characteristic.FirmwareRevision, this.firmware);

        this.service
            .getCharacteristic(Characteristic.TargetDoorState)
            .on("set", this.setTargetDoorState.bind(this));

        if (this.polling) {
            this._getStatus(function() {});

            setInterval(
                function() {
                    this._getStatus(function() {});
                }.bind(this),
                this.pollInterval * 1000
            );
        } else {
            this.service
                .getCharacteristic(Characteristic.CurrentDoorState)
                .updateValue(1);

            this.service
                .getCharacteristic(Characteristic.TargetDoorState)
                .updateValue(1);
        }

        return [this.informationService, this.service];
    },
};
