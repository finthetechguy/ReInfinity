#include "TextConfigItem.h"
#include "logger.h"
#include "patches.h"

#include <coreinit/title.h>
#include <cstdlib>
#include <notifications/notifications.h>
#include <string>
#include <wups.h>
#include <wups/config/WUPSConfigCategory.h>
#include <wups/config/WUPSConfigItemBoolean.h>
#include <wups/config/WUPSConfigItemStub.h>
#include <wups/config_api.h>

WUPS_PLUGIN_NAME("ReInfinity");
WUPS_PLUGIN_DESCRIPTION("Connects Disney Infinity 1.0 to a ReInfinity server");
WUPS_PLUGIN_VERSION("v1.0.0");
WUPS_PLUGIN_AUTHOR("finthetechguy");
WUPS_PLUGIN_LICENSE("ISC");

WUPS_USE_STORAGE("reinfinity");

namespace {
    constexpr char ENABLED_KEY[]         = "enabled";
    constexpr char HOST_KEY[]            = "host";
    constexpr char PORT_KEY[]            = "port";
    constexpr char BYPASS_NINTENDO_KEY[] = "bypassNintendoNetwork";

    constexpr bool DEFAULT_ENABLED         = true;
    constexpr char DEFAULT_HOST[]          = "";
    constexpr int32_t DEFAULT_PORT         = 8080;
    constexpr bool DEFAULT_BYPASS_NINTENDO = true;

    constexpr char HOST_CHARSET[] = "0123456789.abcdefghijklmnopqrstuvwxyz-";
    constexpr char PORT_CHARSET[] = "0123456789";
    constexpr size_t HOST_MAX_LEN = 63;
    constexpr size_t PORT_MAX_LEN = 5;

    constexpr char CONFIG_PATH[] = "/infinity/config/v1/wiiu/";

    bool sEnabled        = DEFAULT_ENABLED;
    std::string sHost    = DEFAULT_HOST;
    int32_t sPort        = DEFAULT_PORT;
    bool sBypassNintendo = DEFAULT_BYPASS_NINTENDO;

    bool sNotificationsReady = false;

    std::string buildConfigUrl() {
        std::string url = "http://" + sHost;
        if (sPort != 80) {
            url += ":" + std::to_string(sPort);
        }
        return url + CONFIG_PATH;
    }

    void notifyInfo(const std::string &text) {
        LOG("%s", text.c_str());
        if (sNotificationsReady) {
            NotificationModule_AddInfoNotification(text.c_str());
        }
    }

    void notifyError(const std::string &text) {
        LOG("%s", text.c_str());
        if (sNotificationsReady) {
            NotificationModule_AddErrorNotification(text.c_str());
        }
    }

    void boolChanged(ConfigItemBoolean *item, bool newValue) {
        const std::string_view id = item->identifier;
        if (id == ENABLED_KEY) {
            sEnabled = newValue;
        } else if (id == BYPASS_NINTENDO_KEY) {
            sBypassNintendo = newValue;
        } else {
            return;
        }
        WUPSStorageAPI::Store(id, newValue);
    }

    void hostChanged(ConfigItemText *, const std::string &newValue) {
        sHost = newValue;
        WUPSStorageAPI::Store(HOST_KEY, sHost);
    }

    void portChanged(ConfigItemText *, const std::string &newValue) {
        const long port = newValue.empty() ? 0 : strtol(newValue.c_str(), nullptr, 10);
        if (port < 1 || port > 65535) {
            LOG("Ignoring invalid port \"%s\"", newValue.c_str());
            return;
        }
        sPort = static_cast<int32_t>(port);
        WUPSStorageAPI::Store(PORT_KEY, sPort);
    }

    WUPSConfigAPICallbackStatus configMenuOpened(WUPSConfigCategoryHandle rootHandle) {
        WUPSConfigCategory root(rootHandle);
        try {
            root.add(WUPSConfigItemBoolean::Create(ENABLED_KEY, "Enabled", DEFAULT_ENABLED, sEnabled, &boolChanged));

            if (TextConfigItem_AddToCategory(rootHandle, HOST_KEY, "Server (IP or domain)", DEFAULT_HOST, sHost,
                                             HOST_CHARSET, HOST_MAX_LEN, &hostChanged) != WUPSCONFIG_API_RESULT_SUCCESS ||
                TextConfigItem_AddToCategory(rootHandle, PORT_KEY, "Port", std::to_string(DEFAULT_PORT), std::to_string(sPort),
                                             PORT_CHARSET, PORT_MAX_LEN, &portChanged) != WUPSCONFIG_API_RESULT_SUCCESS) {
                return WUPSCONFIG_API_CALLBACK_RESULT_ERROR;
            }

            root.add(WUPSConfigItemBoolean::Create(BYPASS_NINTENDO_KEY, "Skip Nintendo Network checks",
                                                   DEFAULT_BYPASS_NINTENDO, sBypassNintendo, &boolChanged));

            root.add(WUPSConfigItemStub::Create(sHost.empty() ? std::string("Config URL: <set a server>") : "Config URL: " + buildConfigUrl()));
        } catch (std::exception &e) {
            LOG("Creating config menu failed: %s", e.what());
            return WUPSCONFIG_API_CALLBACK_RESULT_ERROR;
        }
        return WUPSCONFIG_API_CALLBACK_RESULT_SUCCESS;
    }

    void configMenuClosed() {
        WUPSStorageAPI::SaveStorage();
    }

    void loadSettings() {
        WUPSStorageAPI::GetOrStoreDefault(ENABLED_KEY, sEnabled, DEFAULT_ENABLED);
        WUPSStorageAPI::GetOrStoreDefault(HOST_KEY, sHost, std::string(DEFAULT_HOST));
        WUPSStorageAPI::GetOrStoreDefault(PORT_KEY, sPort, DEFAULT_PORT);
        WUPSStorageAPI::GetOrStoreDefault(BYPASS_NINTENDO_KEY, sBypassNintendo, DEFAULT_BYPASS_NINTENDO);
        if (sPort < 1 || sPort > 65535) {
            sPort = DEFAULT_PORT;
        }
        WUPSStorageAPI::SaveStorage();
    }
} // namespace

INITIALIZE_PLUGIN() {
    initLogging();

    WUPSConfigAPIOptionsV1 configOptions = {.name = "ReInfinity"};
    if (WUPSConfigAPI_Init(configOptions, configMenuOpened, configMenuClosed) != WUPSCONFIG_API_RESULT_SUCCESS) {
        LOG("Failed to init config API");
    }
    loadSettings();

    sNotificationsReady = NotificationModule_InitLibrary() == NOTIFICATION_MODULE_RESULT_SUCCESS;
    if (sNotificationsReady) {
        NotificationModule_SetDefaultValue(NOTIFICATION_MODULE_NOTIFICATION_TYPE_INFO, NOTIFICATION_MODULE_DEFAULT_OPTION_DURATION_BEFORE_FADE_OUT, 8.0f);
        NotificationModule_SetDefaultValue(NOTIFICATION_MODULE_NOTIFICATION_TYPE_ERROR, NOTIFICATION_MODULE_DEFAULT_OPTION_DURATION_BEFORE_FADE_OUT, 15.0f);
    }
    deinitLogging();
}

DEINITIALIZE_PLUGIN() {
    if (sNotificationsReady) {
        NotificationModule_DeInitLibrary();
        sNotificationsReady = false;
    }
}

ON_APPLICATION_START() {
    initLogging();
    if (!sEnabled) {
        return;
    }

    InfinitySites sites;
    if (!LocateInfinitySites(sites)) {
        return; // unsupported version or wrong title
    }
    LOG("Disney Infinity detected! (title %016llX)", OSGetTitleID());

    if (sHost.empty()) {
        notifyError("ReInfinity: no server set. Open the plugin menu (L + Down + SELECT) to set one.");
        return;
    }

    const std::string url = buildConfigUrl();
    if (!PatchConfigUrl(sites.configUrl, url.c_str())) {
        notifyError("ReInfinity: failed to patch the config URL.");
        return;
    }

    bool nintendoOk = true;
    if (sBypassNintendo) {
        nintendoOk = sites.serviceToken != 0 && PatchServiceTokenCheck(sites.serviceToken);
        nintendoOk = sites.networkAccount != 0 && PatchNetworkAccountCheck(sites.networkAccount) && nintendoOk;
    }

    if (nintendoOk) {
        notifyInfo("ReInfinity: using " + url);
    } else {
        notifyError("ReInfinity: using " + url + ", some Nintendo Network checks could not be patched!");
    }
}

ON_APPLICATION_ENDS() {
    deinitLogging();
}
