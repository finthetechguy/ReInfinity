#include "TextConfigItem.h"

#include <cstdio>
#include <wups/config_api.h>

namespace {
    constexpr uint32_t REPEAT_INITIAL_DELAY = 8;

    int32_t displayValue(void *context, bool isSelected, char *outBuf, int32_t outSize) {
        const auto *item = static_cast<ConfigItemText *>(context);

        if (item->editing) {
            // Show the character under the cursor in brackets, or [_] at the append position.
            std::string before = item->value.substr(0, item->cursor);
            std::string at     = item->cursor < item->value.size() ? item->value.substr(item->cursor, 1) : "_";
            std::string after  = item->cursor < item->value.size() ? item->value.substr(item->cursor + 1) : "";
            snprintf(outBuf, outSize, "%s[%s]%s", before.c_str(), at.c_str(), after.c_str());
            return 0;
        }

        const char *shown = item->value.empty() ? "<not set>" : item->value.c_str();
        if (isSelected) {
            snprintf(outBuf, outSize, "(Press A to edit) %s", shown);
        } else {
            snprintf(outBuf, outSize, "%s", shown);
        }
        return 0;
    }

    int32_t getCurrentValueDisplay(void *context, char *outBuf, int32_t outSize) {
        return displayValue(context, false, outBuf, outSize);
    }

    int32_t getCurrentValueSelectedDisplay(void *context, char *outBuf, int32_t outSize) {
        return displayValue(context, true, outBuf, outSize);
    }

    void cycleChar(ConfigItemText *item, int delta) {
        const auto &charset = item->charset;
        if (item->cursor >= item->value.size()) {
            if (item->value.size() >= item->maxLength) {
                return;
            }
            item->value.push_back(delta > 0 ? charset.front() : charset.back());
            return;
        }
        const size_t pos  = charset.find(item->value[item->cursor]);
        const size_t size = charset.size();
        const size_t next = pos == std::string::npos ? 0 : (pos + size + delta) % size;
        item->value[item->cursor] = charset[next];
    }

    void onInput(void *context, WUPSConfigSimplePadData input) {
        auto *item = static_cast<ConfigItemText *>(context);

        if (!item->editing) {
            if (input.buttons_d & WUPS_CONFIG_BUTTON_A) {
                item->valueBeforeEdit = item->value;
                item->editing         = true;
                item->cursor          = 0;
                item->frameTimer      = 0;
            }
            return;
        }

        if (input.buttons_d & (WUPS_CONFIG_BUTTON_A | WUPS_CONFIG_BUTTON_B)) {
            if (input.buttons_d & WUPS_CONFIG_BUTTON_B) {
                item->value = item->valueBeforeEdit;
            }
            item->editing = false;
            return;
        }

        if (input.buttons_d & WUPS_CONFIG_BUTTON_LEFT) {
            if (item->cursor > 0) {
                item->cursor--;
            }
            return;
        }
        // The cursor can sit one past the end, where Up/Down appends a new character.
        if (input.buttons_d & WUPS_CONFIG_BUTTON_RIGHT) {
            const size_t lastPos = item->value.size() < item->maxLength ? item->value.size() : item->maxLength - 1;
            if (item->cursor < lastPos) {
                item->cursor++;
            }
            return;
        }
        if (input.buttons_d & WUPS_CONFIG_BUTTON_X) {
            if (item->cursor < item->value.size()) {
                item->value.erase(item->cursor, 1);
            } else if (item->cursor > 0) {
                item->value.pop_back();
                item->cursor--;
            }
            return;
        }
        if (input.buttons_d & WUPS_CONFIG_BUTTON_Y) {
            item->value.clear();
            item->cursor = 0;
            return;
        }

        const bool isUp   = input.buttons_h & WUPS_CONFIG_BUTTON_UP;
        const bool isDown = input.buttons_h & WUPS_CONFIG_BUTTON_DOWN;
        if (!isUp && !isDown) {
            item->frameTimer = 0;
            return;
        }

        // Change once on press, then repeat every frame after a short delay while held.
        bool apply = false;
        if (input.buttons_d & (WUPS_CONFIG_BUTTON_UP | WUPS_CONFIG_BUTTON_DOWN)) {
            apply            = true;
            item->frameTimer = REPEAT_INITIAL_DELAY;
        } else if (item->frameTimer > 0) {
            item->frameTimer--;
        } else {
            apply = true;
        }
        if (apply) {
            cycleChar(item, isUp ? 1 : -1);
        }
    }

    void restoreDefault(void *context) {
        auto *item   = static_cast<ConfigItemText *>(context);
        item->value  = item->defaultValue;
        item->cursor = 0;
    }

    bool isMovementAllowed(void *context) {
        return !static_cast<ConfigItemText *>(context)->editing;
    }

    void onCloseCallback(void *context) {
        auto *item = static_cast<ConfigItemText *>(context);
        if (item->value != item->valueAtCreation && item->callback != nullptr) {
            item->callback(item, item->value);
        }
    }

    void onDelete(void *context) {
        delete static_cast<ConfigItemText *>(context);
    }
} // namespace

WUPSConfigAPIStatus TextConfigItem_AddToCategory(WUPSConfigCategoryHandle category,
                                                 std::string_view identifier,
                                                 std::string_view displayName,
                                                 std::string_view defaultValue,
                                                 std::string_view currentValue,
                                                 std::string_view charset,
                                                 size_t maxLength,
                                                 TextValueChangedCallback callback) {
    if (charset.empty() || maxLength == 0) {
        return WUPSCONFIG_API_RESULT_INVALID_ARGUMENT;
    }

    auto *item = new ConfigItemText{
            .identifier      = std::string(identifier),
            .defaultValue    = std::string(defaultValue),
            .value           = std::string(currentValue),
            .valueAtCreation = std::string(currentValue),
            .valueBeforeEdit = std::string(currentValue),
            .charset         = std::string(charset),
            .maxLength       = maxLength,
            .editing         = false,
            .cursor          = 0,
            .frameTimer      = 0,
            .callback        = callback,
    };

    constexpr WUPSConfigAPIItemCallbacksV2 callbacks = {
            .getCurrentValueDisplay         = &getCurrentValueDisplay,
            .getCurrentValueSelectedDisplay = &getCurrentValueSelectedDisplay,
            .onSelected                     = nullptr,
            .restoreDefault                 = &restoreDefault,
            .isMovementAllowed              = &isMovementAllowed,
            .onCloseCallback                = &onCloseCallback,
            .onInput                        = &onInput,
            .onInputEx                      = nullptr,
            .onDelete                       = &onDelete,
    };

    const std::string name(displayName);
    const WUPSConfigAPIItemOptionsV2 options = {
            .displayName = name.c_str(),
            .context     = item,
            .callbacks   = callbacks,
    };

    WUPSConfigItemHandle handle;
    WUPSConfigAPIStatus err = WUPSConfigAPI_Item_Create(options, &handle);
    if (err != WUPSCONFIG_API_RESULT_SUCCESS) {
        delete item;
        return err;
    }
    err = WUPSConfigAPI_Category_AddItem(category, handle);
    if (err != WUPSCONFIG_API_RESULT_SUCCESS) {
        WUPSConfigAPI_Item_Destroy(handle);
    }
    return err;
}
