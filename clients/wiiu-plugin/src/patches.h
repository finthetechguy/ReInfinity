#pragma once

#include <cstdint>

// Runtime addresses of each patch site
struct InfinitySites {
    uint32_t configUrl = 0;
    uint32_t serviceToken = 0;
    uint32_t networkAccount = 0;
};

bool LocateInfinitySites(InfinitySites &sites);

bool PatchConfigUrl(uint32_t site, const char *url);
bool PatchServiceTokenCheck(uint32_t site);
bool PatchNetworkAccountCheck(uint32_t site);
