#include "patches.h"
#include "logger.h"

#include <coreinit/cache.h>
#include <coreinit/dynload.h>
#include <coreinit/memorymap.h>
#include <cstring>
#include <kernel/kernel.h>
#include <string_view>
#include <vector>

// Addresses and function names are from Ghidra and debug symbols (Infinity 1.0, USA, v49)
namespace {
    constexpr uint32_t LINK_TEXT_BASE = 0x02000000;
    constexpr char CONFIG_URL_SUFFIX[] = "/infinity/config/v1/wiiu/";
    constexpr uint32_t CONFIG_URL_MAX  = 256;

    constexpr uint32_t BEQ_TO_B_SUCCESS = 0x4800013C; // b +0x13c
    constexpr uint32_t LI_R3_1          = 0x38600001; // li r3, 1

    struct PatternWord {
        uint32_t value;
        uint32_t mask;
        uint32_t alt = 0;
    };

    constexpr uint32_t EXACT = 0xFFFFFFFF;

    struct Site {
        const char *name;
        uint32_t linkAddr; // address of the first pattern word
        const PatternWord *pattern;
        size_t count;
        size_t targetIndex; // word to overwrite
    };

    // CKFSetDefaultURLs: lis r4,hi / subi r4,r4,lo (-> config URL), then the inlined strlen loop on r4.
    constexpr PatternWord CONFIG_URL_PATTERN[] = {
            {0x3C800000, 0xFFFF0000}, // lis   r4, <hi>
            {0x38840000, 0xFFFF0000}, // addi  r4, r4, <lo>
            {0x3984FFFF, EXACT},      // subi  r12, r4, 1
            {0x8C0C0001, EXACT},      // lbzu  r0, 1(r12)
            {0x7C000775, EXACT},      // extsb. r0, r0
            {0x4082FFF8, EXACT},      // bne   -8
    };

    // CafeAcquireIndependentServiceTokenThread: the result check after nn::act::AcquireIndependentServiceToken.
    constexpr PatternWord SERVICE_TOKEN_PATTERN[] = {
            {0x7C601B78, EXACT},      // mr     r0, r3
            {0x9061001C, EXACT},      // stw    r3, 0x1c(r1)
            {0x540A0001, EXACT},      // rlwinm. r10, r0, 0, 0, 0
            {0x90610018, EXACT},      // stw    r3, 0x18(r1)
            {0x3FE00000, 0xFFFF0000}, // lis    r31, <hi>
            {0x4182013C, EXACT, BEQ_TO_B_SUCCESS}, // beq +0x13c (success path) <- target
            {0x540A2FBE, EXACT},      // rlwinm r10, r0, 5, 30, 31
            {0x2C0A0003, EXACT},      // cmpwi  r10, 3
            {0x3D601FF0, EXACT},      // lis    r11, 0x1ff0
            {0x40820008, EXACT},      // bne    +8
    };

    // PlatformAccount::IsAnyPlayerOnline: the nn::act::IsNetworkAccount call.
    constexpr PatternWord NETWORK_ACCOUNT_PATTERN[] = {
            {0x2C000000, EXACT},      // cmpwi r0, 0
            {0x41820020, EXACT},      // beq   +0x20
            {0x48000C51, EXACT},      // bl    WebConnection::NetworkIsActive
            {0x2C030000, EXACT},      // cmpwi r3, 0
            {0x41820014, EXACT},      // beq   +0x14
            {0x48000001, 0xFC000003, LI_R3_1}, // bl nn::act::IsNetworkAccount <- target
            {0x2C030000, EXACT},      // cmpwi r3, 0
            {0x41820008, EXACT},      // beq   +8
            {0x3BE00001, EXACT},      // li    r31, 1
            {0x57E3063E, EXACT},      // clrlwi r3, r31, 24
    };

    constexpr Site CONFIG_URL_SITE      = {"config URL", 0x03A2383C, CONFIG_URL_PATTERN, std::size(CONFIG_URL_PATTERN), 0};
    constexpr Site SERVICE_TOKEN_SITE   = {"service token check", 0x03A1C810, SERVICE_TOKEN_PATTERN, std::size(SERVICE_TOKEN_PATTERN), 5};
    constexpr Site NETWORK_ACCOUNT_SITE = {"network account check", 0x03A1B0F0, NETWORK_ACCOUNT_PATTERN, std::size(NETWORK_ACCOUNT_PATTERN), 5};

    struct Range {
        uint32_t start;
        uint32_t size;

        bool contains(uint32_t addr, uint32_t len) const {
            return size != 0 && addr >= start && len <= size && addr - start <= size - len;
        }
    };

    struct MainModule {
        Range text;
        Range data;
        Range read;
    };

    bool endsWithRpx(const char *name) {
        if (name == nullptr) {
            return false;
        }
        const size_t len = strlen(name);
        return len >= 4 && strcasecmp(name + len - 4, ".rpx") == 0;
    }

    bool findMainModule(MainModule &out) {
        const int32_t count = OSDynLoad_GetNumberOfRPLs();
        if (count <= 0) {
            LOG("OSDynLoad_GetNumberOfRPLs returned %d", count);
            return false;
        }
        std::vector<OSDynLoad_NotifyData> infos(count);
        if (!OSDynLoad_GetRPLInfo(0, count, infos.data())) {
            LOG("OSDynLoad_GetRPLInfo failed");
            return false;
        }
        for (const auto &info : infos) {
            if (endsWithRpx(info.name)) {
                out.text = {info.textAddr, info.textSize};
                out.data = {info.dataAddr, info.dataSize};
                out.read = {info.readAddr, info.readSize};
                LOG("Main module %s: text %08X+%X, data %08X+%X, read %08X+%X", info.name,
                    info.textAddr, info.textSize, info.dataAddr, info.dataSize, info.readAddr, info.readSize);
                return true;
            }
        }
        LOG("No .rpx module found");
        return false;
    }

    bool matches(uint32_t addr, const Site &site) {
        const auto *words = reinterpret_cast<const volatile uint32_t *>(addr);
        for (size_t i = 0; i < site.count; i++) {
            const PatternWord &p = site.pattern[i];
            if ((words[i] & p.mask) != (p.value & p.mask) && !(p.alt != 0 && words[i] == p.alt)) {
                return false;
            }
        }
        return true;
    }

    // Also require the lis/addi pair to point at the config URL, since the strlen loop is repeated for every default URL.
    bool pointsAtConfigUrl(uint32_t addr, const MainModule &module) {
        const auto *words      = reinterpret_cast<const volatile uint32_t *>(addr);
        const uint32_t hi      = words[0] & 0xFFFF;
        const int16_t lo       = static_cast<int16_t>(words[1] & 0xFFFF);
        const uint32_t strAddr = (hi << 16) + lo;
        const bool inModule = module.data.contains(strAddr, CONFIG_URL_MAX) || module.read.contains(strAddr, CONFIG_URL_MAX);
        if (!inModule && !(OSIsAddressValid(strAddr) && OSIsAddressValid(strAddr + CONFIG_URL_MAX - 1))) {
            return false;
        }
        const std::string_view url(reinterpret_cast<const char *>(strAddr), strnlen(reinterpret_cast<const char *>(strAddr), CONFIG_URL_MAX));
        return url.size() < CONFIG_URL_MAX && url.ends_with(CONFIG_URL_SUFFIX);
    }

    uint32_t locate(const Site &site, const MainModule &module) {
        const uint32_t len          = site.count * sizeof(uint32_t);
        const uint32_t candidates[] = {site.linkAddr, module.text.start + (site.linkAddr - LINK_TEXT_BASE)};
        for (const uint32_t addr : candidates) {
            if (!module.text.contains(addr, len) || !matches(addr, site)) {
                continue;
            }
            if (&site == &CONFIG_URL_SITE && !pointsAtConfigUrl(addr, module)) {
                continue;
            }
            const uint32_t target = addr + site.targetIndex * sizeof(uint32_t);
            LOG("Found %s at %08X", site.name, target);
            return target;
        }
        LOG("Did not find %s", site.name);
        return 0;
    }

    uint32_t toPhysical(uint32_t addr) {
        const uint32_t phys = OSEffectiveToPhysical(addr);
        if (phys == 0 && addr >= 0x00800000 && addr < 0x01000000) {
            return addr + (0x30800000 - 0x00800000);
        }
        return phys;
    }

    // Text is read-only to the app, so write through the kernel's physical copy
    bool writeWord(uint32_t addr, uint32_t value) {
        uint32_t source        = value;
        const uint32_t dstPhys = toPhysical(addr);
        const uint32_t srcPhys = toPhysical(reinterpret_cast<uint32_t>(&source));
        if (dstPhys == 0 || srcPhys == 0) {
            LOG("No physical address for %08X or the patch value, skipping", addr);
            return false;
        }
        DCFlushRange(&source, sizeof(source));
        KernelCopyData(dstPhys, srcPhys, sizeof(source));
        DCFlushRange(reinterpret_cast<void *>(addr), sizeof(uint32_t));
        ICInvalidateRange(reinterpret_cast<void *>(addr), sizeof(uint32_t));
        const uint32_t written = *reinterpret_cast<const volatile uint32_t *>(addr);
        if (written != value) {
            LOG("Write to %08X failed: wanted %08X, read back %08X", addr, value, written);
            return false;
        }
        return true;
    }
} // namespace

bool LocateInfinitySites(InfinitySites &sites) {
    sites = {};
    MainModule module{};
    if (!findMainModule(module)) {
        return false;
    }
    sites.configUrl = locate(CONFIG_URL_SITE, module);
    if (sites.configUrl == 0) {
        return false;
    }
    sites.serviceToken   = locate(SERVICE_TOKEN_SITE, module);
    sites.networkAccount = locate(NETWORK_ACCOUNT_SITE, module);
    return true;
}

bool PatchConfigUrl(uint32_t site, const char *url) {
    // The game copies the string when CKFSetDefaultURLs runs, so it needs to live as long as the plugin does.
    static char sConfigUrl[256];
    strncpy(sConfigUrl, url, sizeof(sConfigUrl) - 1);
    sConfigUrl[sizeof(sConfigUrl) - 1] = '\0';
    DCFlushRange(sConfigUrl, sizeof(sConfigUrl));

    const auto addr = reinterpret_cast<uint32_t>(sConfigUrl);
    const uint32_t ha = (addr + 0x8000) >> 16;
    const uint32_t lo = addr & 0xFFFF;
    const bool ok     = writeWord(site, 0x3C800000 | ha) && writeWord(site + 4, 0x38840000 | lo);
    LOG("Config URL -> %s (%s)", sConfigUrl, ok ? "patched" : "FAILED");
    return ok;
}

bool PatchServiceTokenCheck(uint32_t site) {
    const bool ok = writeWord(site, BEQ_TO_B_SUCCESS);
    LOG("Service token check %s", ok ? "patched" : "FAILED");
    return ok;
}

bool PatchNetworkAccountCheck(uint32_t site) {
    const bool ok = writeWord(site, LI_R3_1);
    LOG("Network account check %s", ok ? "patched" : "FAILED");
    return ok;
}
