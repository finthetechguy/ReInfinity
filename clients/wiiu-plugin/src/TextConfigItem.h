#pragma once

#include <string>
#include <string_view>
#include <wups/config.h>

// A config menu item for editing short text with the D-pad.
struct ConfigItemText;

using TextValueChangedCallback = void (*)(ConfigItemText *item, const std::string &newValue);

struct ConfigItemText {
    std::string identifier;
    std::string defaultValue;
    std::string value;
    std::string valueAtCreation;
    std::string valueBeforeEdit;
    std::string charset;
    size_t maxLength;
    bool editing;
    size_t cursor;
    uint32_t frameTimer;
    TextValueChangedCallback callback;
};

WUPSConfigAPIStatus TextConfigItem_AddToCategory(WUPSConfigCategoryHandle category,
                                                 std::string_view identifier,
                                                 std::string_view displayName,
                                                 std::string_view defaultValue,
                                                 std::string_view currentValue,
                                                 std::string_view charset,
                                                 size_t maxLength,
                                                 TextValueChangedCallback callback);
