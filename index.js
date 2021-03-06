var Noble = require('@abandonware/noble');
var Service, Characteristic;

var BLELIGHTS_SERVICE = "cc02";
var BLELIGHTS_RGB_CHARACTERISTIC_WRITE = "ee03";
var BLELIGHTS_RGB_CHARACTERISTIC_READ = "ee01";

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    homebridge.registerAccessory("homebridge-ble-bulb-osso", "BLELamp", BLElightAccessory);
}

function BLElightAccessory(log, config) {
    this.log = log;
    this.name = config["name"];
    this.address = config["address"];
    this.minBrightness = config["minBrightness"];

    this.lightService = new Service.Lightbulb(this.name);

    this.lightService
        .getCharacteristic(Characteristic.On) // bool
        .on('set', this.setPowerState.bind(this))
        .on('get', this.getPowerState.bind(this));

    this.lightService
        .getCharacteristic(Characteristic.Brightness) // int 0-100
        .on('set', this.setBrightness.bind(this))
        .on('get', this.getBrightness.bind(this));

    this.lightService
        .getCharacteristic(Characteristic.Saturation) // float 0-100
        .on('set', this.setSaturation.bind(this))
        .on('get', this.getSaturation.bind(this));

    this.lightService
        .getCharacteristic(Characteristic.Hue) // float 0-360
        .on('set', this.setHue.bind(this))
        .on('get', this.getHue.bind(this));

    this.nobleCharacteristicRead = null;
    this.nobleCharacteristicWrite = null;
    Noble.on('stateChange', this.nobleStateChange.bind(this));

    this.readCallbacks = [];
    this.preIdentifyValues = {};
}

BLElightAccessory.prototype.getServices = function() {
    return [this.lightService];
}

BLElightAccessory.prototype.identfy = function(callback) {
    this.log("Identify requested, flashing red -> green -> blue");
    this.preIdentifyValues = {
        hue: this.hue,
        brightness: this.brightness,
        saturation: this.saturation,
        powerState: this.powerState
    };
    this.flash(255, 0, 0, 500, function() {
        this.flash(0, 255, 0, 500, function() {
            this.flash(0, 0, 255, 500, function() {
                this.hue = this.preIdentifyValues.hue;
                this.brightness = this.preIdentifyValues.brightness;
                this.saturation = this.preIdentifyValues.saturation;
                this.powerState = this.preIdentifyValues.powerState;
                this.writeToBulb(function() {
                    callback(null);
                }.bind(this));
            }.bind(this));
        }.bind(this));
    }.bind(this));
}

BLElightAccessory.prototype.flash = function(r, g, b, duration, callback) {
    var hsv = this.rgb2hsv(r, g, b);
    this.hue = hsv.h;
    this.saturation = hsv.s;
    this.brightness = hsv.v;
    this.powerState = true;
    this.writeToBulb(function() {
        setTimeout(function() {
            callback();
        }, duration);
    });
}

BLElightAccessory.prototype.setPowerState = function(powerState, callback) {
    this.log.info("setPowerState: " + powerState);
    this.powerState = powerState;
    this.writeToBulb(function() {
        callback(null);
    });
}

BLElightAccessory.prototype.setBrightness = function(value, callback) {
    this.log.info("setBrightness: " + value);
    if (value > 0 && this.minBrightness !== undefined) {
        value = this.minBrightness + (value / 100) * (100 - this.minBrightness);
        this.log.debug("... Adjusted to ranged value: " + value);
    }
    this.brightness = value;
    this.writeToBulb(function() {
        callback(null);
    });
}

BLElightAccessory.prototype.setSaturation = function(value, callback) {
    this.log.info("setSaturation: " + value);
    this.saturation = value;
    this.writeToBulb(function() {
        callback(null);
    });
}

BLElightAccessory.prototype.setHue = function(value, callback) {
    this.log.info("setHue: " + value);
    this.hue = value;
    this.writeToBulb(function() {
        callback(null);
    });
}

BLElightAccessory.prototype.getPowerState = function(callback) {
    this.log.debug("getPowerState called");
    this.readFromBulb(function (error) {
        this.log.debug("Returning from getPowerState: " + (error === null ? this.powerState : "ERROR"));
        callback(error, error === null ? this.powerState : null);
    }.bind(this));
}

BLElightAccessory.prototype.getBrightness = function(callback) {
    this.log.debug("getBrightness called");
    this.readFromBulb(function (error) {
        this.log.debug("Returning from getBrightness: " + (error === null ? this.brightness : "ERROR"));
        callback(error, error === null ? this.brightness : null);
    }.bind(this));
}

BLElightAccessory.prototype.getSaturation = function(callback) {
    this.log.debug("getSaturation called");
    this.readFromBulb(function (error) {
        this.log.debug("Returning from getSaturation: " + (error === null ? this.saturation : "ERROR"));
        callback(error, error === null ? this.saturation : null);
    }.bind(this));
}

BLElightAccessory.prototype.getHue = function(callback) {
    this.log.debug("getHue called");
    this.readFromBulb(function (error) {
        this.log.debug("Returning from getHue: " + (error === null ? this.hue : "ERROR"));
        callback(error, error === null ? this.hue : null);
    }.bind(this));
}


BLElightAccessory.prototype.nobleStateChange = function(state) {
    if (state === "poweredOn") {
        this.log.info("Starting Noble scan..");
        try {
            Noble.startScanning([], false);
        } catch (e) {
            this.log.error(e);
        }
        Noble.on('discover', this.nobleDiscovered.bind(this));
    } else {
        this.log.info("Noble state change to " + state + "; stopping scan.");
        Noble.stopScanning();
    }
}

BLElightAccessory.prototype.nobleDiscovered = function(accessory) {
    this.log.debug("Accesory address: " + accessory.address);
    if (accessory.address == this.address) {
        this.log.info("Found accesory for " + this.name + ", connecting..");
        accessory.connect(function(error) {
            this.nobleConnected(error, accessory);
        }.bind(this));
        accessory.discoverServices([BLELIGHTS_SERVICE], this.nobleServicesDicovered.bind(this));
    } else {
        this.log.debug("Found non-matching accessory " + accessory.address);
    }
}

BLElightAccessory.prototype.nobleConnected = function(error, accessory) {
    if (error) return this.log.error("Noble connection failed: " + error);
    this.log.info("Connection success, discovering services..");
    Noble.stopScanning();
    accessory.discoverServices([BLELIGHTS_SERVICE], this.nobleServicesDicovered.bind(this));
    accessory.on('disconnect', function(error) {
        this.nobleDisconnected(error, accessory);
    }.bind(this));
}

BLElightAccessory.prototype.nobleDisconnected = function(error, accessory) {
    this.log.info("Disconnected from " + accessory.address + ": " + (error ? error : "(No error)"));
    accessory.removeAllListeners('disconnect');
    this.log.info("Restaring Noble scan..");
    Noble.startScanning([], false);
}

BLElightAccessory.prototype.nobleServicesDicovered = function(error, services) {
    this.log.info("Service discovered");
    if (error) return this.log.error("Noble services discovery failed: " + error);
    for (var service of services) {
        service.discoverCharacteristics([], this.nobleCharacteristicsDiscovered.bind(this));
    }
}

BLElightAccessory.prototype.nobleCharacteristicsDiscovered = function(error, characteristics) {
    this.log.info("Characteristic discovered")
    if (error) return this.log.error("Noble characteristics discovery failed: " + error);
    for (var characteristic of characteristics) {
        if (characteristic.uuid == BLELIGHTS_RGB_CHARACTERISTIC_WRITE) {
            this.log.info("Found RGB Characteristic: " + characteristic.uuid);
            this.nobleCharacteristicWrite = characteristic;
            Noble.stopScanning();
        }
        if (characteristic.uuid == BLELIGHTS_RGB_CHARACTERISTIC_READ) {
            this.log.info("Found RGB Characteristic: " + characteristic.uuid);
            this.nobleCharacteristicRead = characteristic;
        }
    }
}

BLElightAccessory.prototype.readFromBulb = function(callback) {
    if (this.nobleCharacteristicRead == null) {
        this.log.warn("Characteristic not yet found. Skipping..");
        callback(false);
        return;
    }
    this.readCallbacks.push(callback);

    if (this.readCallbacks.length > 1) {
        this.log.debug("Outstanding 'readFromBulb' request already active."
            + " Adding callback to queue. (" + this.readCallbacks.length + ")");
    } else {
        this.log.debug("No callback queue, sending 'read' call to nobleCharacteristic");
        this.nobleCharacteristicRead.read(function(error, buffer) {
            this.log.debug("Executing noble 'read' callback");
            if (error === null) {
                this.log.debug("Got success response from characteristic");
                var r = buffer.readUInt8(7);
                var g = buffer.readUInt8(1);
                var b = buffer.readUInt8(5);

                var hsv = this.rgb2hsv(r, g, b);
                this.hue = hsv.h;
                this.saturation = hsv.s;
                this.brightness = hsv.v;
                this.powerState = hsv.v > 0;
                this.log.debug("Get: "
                    + "rgb("+r+","+g+","+b+") "
                    + "= hsv("+hsv.h+","+hsv.v+","+hsv.v+") "
                    + "(" + (this.powerState ? "On" : "Off") + ")");
            } else {
                this.log.error("Read from bluetooth characteristic failed: " + error);
            }

            this.log.debug("Sending result to " + this.readCallbacks.length + " queued callbacks");
            this.readCallbacks.forEach(function(queuedCallback, index) {
                queuedCallback(error);
            });
            this.log.debug("Clearing callback queue");
            this.readCallbacks = [];
        }.bind(this));
    }
}

BLElightAccessory.prototype.writeToBulb = function(callback) {
    if (this.nobleCharacteristicWrite == null) {
        this.log.warn("Characteristic not yet found. Skipping..");
        callback(false);
        return;
    }
    var rgb = this.hsv2rgb(this.hue, this.saturation, this.brightness);
    this.log.debug("Set: "
        + "hsv("+this.hue+","+this.saturation+","+this.brightness+") "
        + "= rgb("+rgb.r+","+rgb.b+","+rgb.b+") "
        + "(" + (this.powerState ? "On" : "Off") + ")");

    var buffer = Buffer.alloc(10);

    buffer.writeUInt8(0x01, 0);
    buffer.writeUInt8(this.powerState ? rgb.g : 0, 1);
    buffer.writeUInt8(0x00, 2);
    buffer.writeUInt8(0x00, 3);
    buffer.writeUInt8(0x01, 4);
    buffer.writeUInt8(this.powerState ? rgb.b : 0, 5);
    buffer.writeUInt8(0x01, 6);
    buffer.writeUInt8(this.powerState ? rgb.r : 0, 7);
    buffer.writeUInt8(0x00, 8);
    buffer.writeUInt8(0x00, 9);
    this.nobleCharacteristicWrite.write(buffer, false);
    callback();
}

// From http://stackoverflow.com/questions/8022885/rgb-to-hsv-color-in-javascript
BLElightAccessory.prototype.rgb2hsv = function(r, g, b) {
	var rr, gg, bb,
			r = r / 255,
			g = g / 255,
			b = b / 255,
			h, s,
			v = Math.max(r, g, b),
			diff = v - Math.min(r, g, b),
			diffc = function(c){
					return (v - c) / 6 / diff + 1 / 2;
			};

	if (diff == 0) {
			h = s = 0;
	} else {
			s = diff / v;
			rr = diffc(r);
			gg = diffc(g);
			bb = diffc(b);

			if (r === v) {
					h = bb - gg;
			}else if (g === v) {
					h = (1 / 3) + rr - bb;
			}else if (b === v) {
					h = (2 / 3) + gg - rr;
			}
			if (h < 0) {
					h += 1;
			}else if (h > 1) {
					h -= 1;
			}
	}
	return {
			h: Math.round(h * 360),
			s: Math.round(s * 100),
			v: Math.round(v * 100)
	};
}

// From https://gist.github.com/eyecatchup/9536706
BLElightAccessory.prototype.hsv2rgb = function(h, s, v) {
		var r, g, b;
		var i;
		var f, p, q, t;
		 
		// Make sure our arguments stay in-range
		h = Math.max(0, Math.min(360, h));
		s = Math.max(0, Math.min(100, s));
		v = Math.max(0, Math.min(100, v));
		 
		// We accept saturation and value arguments from 0 to 100 because that's
		// how Photoshop represents those values. Internally, however, the
		// saturation and value are calculated from a range of 0 to 1. We make
		// That conversion here.
		s /= 100;
		v /= 100;
		 
		if(s == 0) {
				// Achromatic (grey)
				r = g = b = v;
				return {
						r: Math.round(r * 255), 
						g: Math.round(g * 255), 
						b: Math.round(b * 255)
				};
		}
		 
		h /= 60; // sector 0 to 5
		i = Math.floor(h);
		f = h - i; // factorial part of h
		p = v * (1 - s);
		q = v * (1 - s * f);
		t = v * (1 - s * (1 - f));
		 
		switch(i) {
				case 0: r = v; g = t; b = p; break;
				case 1: r = q; g = v; b = p; break;
				case 2: r = p; g = v; b = t; break;
				case 3: r = p; g = q; b = v; break;
				case 4: r = t; g = p; b = v; break;
				default: r = v; g = p; b = q;
		}
		 
		return {
				r: Math.round(r * 255), 
				g: Math.round(g * 255), 
				b: Math.round(b * 255)
		};
}