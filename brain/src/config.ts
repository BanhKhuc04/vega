/** Brain settings, read once from the environment (`.env` in dev, `infra/pi/brain.env` + compose on the Pi). */
export interface Config {
  mqttUrl: string;
  mqttUser?: string;
  mqttPass?: string;
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): Config {
  return {
    mqttUrl: env.MQTT_URL || 'mqtt://localhost:1883',
    ...(env.MQTT_USER && { mqttUser: env.MQTT_USER }),
    ...(env.MQTT_PASS && { mqttPass: env.MQTT_PASS }),
  };
}
