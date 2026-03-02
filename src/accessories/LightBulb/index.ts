import { PlatformAccessory, Characteristic, Service, Logger } from 'homebridge';

import ColorTemperature from './characteristics/ColorTemperature';
import Brightness from './characteristics/Brightness';
import Saturation from './characteristics/Saturation';
import Hue from './characteristics/Hue';
import On from './characteristics/On';

import { HOME_KIT_VALUES, toHomeKitValues, TP_LINK_VALUES } from '../../utils/translateColorTemp';
import DeviceInfo from '../../api/@types/DeviceInfo';
import Accessory from '../../@types/Accessory';
import Context from '../../@types/Context';
import TPLink from '../../api/TPLink';
import Platform from '../../platform';

export type AccessoryThisType = ThisType<{
  readonly powerChar: Characteristic;
  readonly tpLink: TPLink;
  readonly log: Logger;
  readonly mac: string;
  saturation: number;
  hue: number;
}>;

export default class LightBulbAccessory extends Accessory {
  private readonly powerChar: Characteristic;
  private readonly service: Service;

  private _hue?: number;
  private _saturation?: number;

  private set hue(value: number) {
    this._hue = value;
    this.updateHueAndSat();
  }

  private set saturation(value: number) {
    this._saturation = value;
    this.updateHueAndSat();
  }

  public get UUID() {
    return this.accessory.UUID.toString();
  }

  constructor(
    platform: Platform,
    accessory: PlatformAccessory<Context>,
    log: Logger,
    deviceInfo: DeviceInfo
  ) {
    super(platform, accessory, log, deviceInfo);

    let isColorTemperatureBlocked = false;
    let hasBrightness = false;
    let hasColors = false;

    if (
      deviceInfo.color_temp !== undefined ||
      deviceInfo.saturation !== undefined ||
      deviceInfo.hue !== undefined
    ) {
      hasColors = true;
    }

    if (
      deviceInfo.color_temp_range?.length !== undefined &&
      deviceInfo.color_temp_range?.[0] !== undefined &&
      deviceInfo.color_temp_range[0] === deviceInfo.color_temp_range?.[1]
    ) {
      isColorTemperatureBlocked = true;
    }

    if (deviceInfo.brightness !== undefined) {
      hasBrightness = true;
    }

    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.Characteristic.Manufacturer,
        'TP-Link Technologies'
      )
      .setCharacteristic(this.platform.Characteristic.Model, this.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.mac);

    this.service =
      this.accessory.getService(this.platform.Service.Lightbulb) ||
      this.accessory.addService(this.platform.Service.Lightbulb);

    this.powerChar = this.service
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(On.get.bind(this))
      .onSet(On.set.bind(this));

    if (hasBrightness) {
      this.service
        .getCharacteristic(this.platform.Characteristic.Brightness)
        .onGet(Brightness.get.bind(this))
        .onSet(Brightness.set.bind(this));
    }

    if (hasColors) {
      this.service
        .getCharacteristic(this.platform.Characteristic.Hue)
        .onGet(Hue.get.bind(this))
        .onSet(Hue.set.bind(this));

      this.service
        .getCharacteristic(this.platform.Characteristic.Saturation)
        .onGet(Saturation.get.bind(this))
        .onSet(Saturation.set.bind(this));
    }

    if (hasColors && !isColorTemperatureBlocked) {
      this.service
        .getCharacteristic(this.platform.Characteristic.ColorTemperature)
        .setProps({
          minValue: HOME_KIT_VALUES.min,
          maxValue: HOME_KIT_VALUES.max
        })
        .onGet(ColorTemperature.get.bind(this))
        .onSet(ColorTemperature.set.bind(this));

      const adaptiveLightingController =
        new this.platform.api.hap.AdaptiveLightingController(this.service, {
          controllerMode:
            this.platform.api.hap.AdaptiveLightingControllerMode.AUTOMATIC
        });

      this.accessory.configureController(adaptiveLightingController);
    }

    // Start background polling to keep cache warm and push updates to HomeKit
    this.tpLink.startPolling((info: DeviceInfo) => {
      try {
        this.service.updateCharacteristic(
          this.platform.Characteristic.On,
          info.device_on || false
        );

        if (hasBrightness) {
          this.service.updateCharacteristic(
            this.platform.Characteristic.Brightness,
            info.brightness || 100
          );
        }

        if (hasColors) {
          this.service.updateCharacteristic(
            this.platform.Characteristic.Hue,
            info.hue || 0
          );
          this.service.updateCharacteristic(
            this.platform.Characteristic.Saturation,
            info.saturation || 0
          );
        }

        if (hasColors && !isColorTemperatureBlocked) {
          const colorTemp = toHomeKitValues(info.color_temp || TP_LINK_VALUES.min);
          const clampedTemp = Math.min(
            HOME_KIT_VALUES.max,
            Math.max(HOME_KIT_VALUES.min, colorTemp)
          );
          this.service.updateCharacteristic(
            this.platform.Characteristic.ColorTemperature,
            clampedTemp
          );
        }
      } catch (e: any) {
        this.log.debug('Failed to update LightBulb characteristics:', e.message);
      }
    });
  }

  private async updateHueAndSat() {
    try {
      if (this._hue !== undefined && this._saturation !== undefined) {
        const h = parseInt(this._hue.toString());
        const s = parseInt(this._saturation.toString());
        this._hue = undefined;
        this._saturation = undefined;
        await this.tpLink.sendCommand('hueAndSaturation', h, s);
      }
    } catch (err: any) {
      this.log.error(
        'Failed to update hue and saturation:',
        this.mac,
        '|',
        err.message
      );
    }
  }
}
