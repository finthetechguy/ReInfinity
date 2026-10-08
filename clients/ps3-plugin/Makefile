# Builds the two PS3 modules of the ReInfinity redirect plugin:
#   reinfinity_game  loaded into Disney Infinity's process; hooks its online imports
#   reinfinity_vsh   VSH (XMB) plugin; loads the game module, hosts the settings
#
#   make          compile, link and pack build/reinfinity_{game,vsh}.prx
#   make sprx     also sign them as .sprx (scetool, see scripts/sign.sh)
#   make info     dump both PRXs' tables with scripts/prxinfo.py
#   make package  sign, then put the PS3's files in build/package/ and build/ReInfinity-PS3.zip
#
# Each module is signed with its own SELF header; override with e.g. `make sprx SIGN_game=vsh`.

CROSS    ?= powerpc64-linux-gnu-
CC        = $(CROSS)gcc
LD        = $(CROSS)ld
BUILD     = build
MODULES   = game vsh
SIGN_game ?= game
SIGN_vsh  ?= vsh

# -mstrict-align: game structs are only 4-byte aligned, and gcc would otherwise copy them with
# 8-byte loads.
CFLAGS  = -O2 -mcpu=cell -mabi=elfv1 -mno-altivec -mno-vsx -mstrict-align -ffreestanding -fno-pic -fno-common \
          -fno-stack-protector -fno-asynchronous-unwind-tables -fno-exceptions \
          -fno-tree-loop-distribute-patterns -fno-jump-tables -Wall -Wextra -Isrc/common

COMMON_SRCS = $(wildcard src/common/*.c)
COMMON_ASM  = $(wildcard src/common/*.S)
COMMON_HDRS = $(wildcard src/common/*.h)
objs = $(patsubst src/%.c,$(BUILD)/%.o,$(COMMON_SRCS) $(wildcard src/$(1)/*.c)) \
       $(patsubst src/%.S,$(BUILD)/%.o,$(COMMON_ASM)) $(BUILD)/$(1)_imports.o
game_OBJS = $(call objs,game)
vsh_OBJS  = $(call objs,vsh)

all: $(MODULES:%=$(BUILD)/reinfinity_%.prx)

sprx: $(MODULES:%=$(BUILD)/reinfinity_%.sprx)

$(BUILD)/%.o: src/%.c $(COMMON_HDRS) $(wildcard src/*/*.h)
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -c $< -o $@

$(BUILD)/%.o: src/%.S
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -c $< -o $@

# main.c logs the build time, so rebuild it whenever any of its module's sources change.
$(BUILD)/game/main.o: $(COMMON_SRCS) $(wildcard src/game/*.c)
$(BUILD)/vsh/main.o: $(COMMON_SRCS) $(wildcard src/vsh/*.c)

$(BUILD)/%_imports.S: prx/%.json scripts/mkprx.py
	@mkdir -p $(BUILD)
	python3 scripts/mkprx.py imports $< $@

$(BUILD)/%_imports.o: $(BUILD)/%_imports.S
	$(CC) $(CFLAGS) -c $< -o $@

.SECONDEXPANSION:
$(BUILD)/reinfinity_%.elf: $$(%_OBJS) prx/prx.ld
	$(LD) -T prx/prx.ld --emit-relocs -o $@ $($*_OBJS)

$(BUILD)/reinfinity_%.prx: $(BUILD)/reinfinity_%.elf prx/%.json scripts/mkprx.py
	python3 scripts/mkprx.py pack prx/$*.json $< $@

$(BUILD)/reinfinity_%.sprx: $(BUILD)/reinfinity_%.prx scripts/sign.sh
	scripts/sign.sh $(SIGN_$*) $< $@

# Laid out from the root of the PS3's hard drive. There's no config.txt, so copying never replaces
# the player's settings.
PACKAGE = $(BUILD)/package
package: sprx
	rm -rf $(PACKAGE) $(BUILD)/ReInfinity-PS3.zip
	mkdir -p $(PACKAGE)/dev_hdd0/reinfinity
	cp $(MODULES:%=$(BUILD)/reinfinity_%.sprx) install/config.example.txt $(PACKAGE)/dev_hdd0/reinfinity/
	cd $(PACKAGE) && zip -qr ../ReInfinity-PS3.zip dev_hdd0

info: all
	@for m in $(MODULES); do python3 scripts/prxinfo.py $(BUILD)/reinfinity_$$m.prx; done

clean:
	rm -rf $(BUILD)

# Keep the generated stubs and linked ELFs for debugging.
.SECONDARY:

.PHONY: all sprx package info clean
