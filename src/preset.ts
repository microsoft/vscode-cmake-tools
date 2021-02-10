interface Preset {
  name: string;
  displayName: string;
  description: string;
}

export interface ConfigurePreset extends Preset {

}

export interface BuildPreset extends Preset {

}

export interface TestPreset extends Preset {

}
