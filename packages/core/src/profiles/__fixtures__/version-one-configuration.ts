/**
 * A copy of a real customized version 1 configuration: a Default profile spanning
 * two displays, two application profiles on one display, and a profile holding
 * color values that never reached a display.
 */
export const versionOneConfigurationFixture = {
  "schemaVersion": 1,
  "profiles": [
    {
      "id": "default",
      "name": "Default profile",
      "enabled": true,
      "color": {
        "saturation": 69
      },
      "lastColorValues": {
        "brightness": 59,
        "contrast": 25,
        "gamma": 1,
        "saturation": 69,
        "hue": 0
      },
      "applications": [],
      "displays": [
        { "displayId": "display:355f1efb6477b78b6c7a15fa935aaccc" },
        { "displayId": "display:551e7e413a7461154c7fce64df890e63" }
      ]
    },
    {
      "id": "39f1eca3-6fc7-4022-be23-088176604eed",
      "name": "Tarkov Night",
      "enabled": true,
      "color": {
        "brightness": 84,
        "contrast": 45,
        "gamma": 1.15,
        "saturation": 77
      },
      "lastColorValues": {
        "brightness": 84,
        "contrast": 45,
        "gamma": 1.15,
        "saturation": 77,
        "hue": 13
      },
      "applications": [
        {
          "executableName": "EscapeFromTarkov.exe",
          "executablePath": "C:\\Battlestate Games\\Escape from Tarkov\\EscapeFromTarkov.exe"
        }
      ],
      "displays": [{ "displayId": "display:355f1efb6477b78b6c7a15fa935aaccc" }]
    },
    {
      "id": "16111f4f-c9ea-4b2a-a25a-367f0e97af74",
      "name": "Tarkov - Day",
      "enabled": true,
      "color": {
        "brightness": 52,
        "contrast": 52,
        "saturation": 77
      },
      "lastColorValues": {
        "brightness": 52,
        "contrast": 52,
        "gamma": 1.35,
        "saturation": 77,
        "hue": 0
      },
      "applications": [
        {
          "executableName": "EscapeFromTarkov.exe",
          "executablePath": "C:\\Battlestate Games\\Escape from Tarkov\\EscapeFromTarkov.exe"
        }
      ],
      "displays": [{ "displayId": "display:355f1efb6477b78b6c7a15fa935aaccc" }]
    },
    {
      "id": "5b0a41f2-1f0c-42f7-9d4a-2f1f7d9b6c31",
      "name": "Unassigned draft",
      "enabled": true,
      "color": {
        "brightness": 30,
        "hue": 12
      },
      "applications": [],
      "displays": []
    }
  ],
  "settings": {
    "defaultProfileId": "default"
  }
} as const
