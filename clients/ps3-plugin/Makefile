# Builds the two PS3 modules of the ReInfinity redirect plugin:
#   reinfinity_game  loaded into Disney Infinity's process; hooks its online imports
#   reinfinity_vsh   VSH (XMB) plugin; loads the game module, hosts the settings
#
#   make          compile, link and pack build/reinfinity_{game,vsh}.prx
#   make sprx     also sign them as .sprx (scetool, see scripts/sign.sh)
#   make info     dump both PRXs' tables with scripts/prxinfo.py
#
# Each module is signed with its own SELF header; override with e.g. `make sprx SIGN_game=vsh`.

CROSS    ?= powerpc64-linux-gnu-
CC        = $(CROSS)gcc
LD        = $(CROSS)ld
BUILD     = build
MODULES   = game vsh
SIGN_game ?= game
SIGN_vsh  ?= vsh

CFLAGS  = -O2 -mcpu=cell -mabi=elfv1 -mno-altivec -mno-vsx -ffreestanding -fno-pic -fno-common \
          -fno-stack-protector -fno-asynchronous-unwind-tables -fno-exceptions \
          -fno-tree-loop-distribute-patterns -fno-jump-tables -Wall -Wextra -Isrc/common

COMMON_SRCS = $(wildcard src/common/*.c)
COMMON_HDRS = $(wildcard src/common/*.h)
objs = $(patsubst src/%.c,$(BUILD)/%.o,$(COMMON_SRCS) $(wildcard src/$(1)/*.c)) $(BUILD)/$(1)_imports.o
game_OBJS = $(call objs,game)
vsh_OBJS  = $(call objs,vsh)

all: $(MODULES:%=$(BUILD)/reinfinity_%.prx)

sprx: $(MODULES:%=$(BUILD)/reinfinity_%.sprx)

$(BUILD)/%.o: src/%.c $(COMMON_HDRS) $(wildcard src/*/*.h)
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

info: all
	@for m in $(MODULES); do python3 scripts/prxinfo.py $(BUILD)/reinfinity_$$m.prx; done

clean:
	rm -rf $(BUILD)

# Keep the generated stubs and linked ELFs for debugging.
.SECONDARY:

.PHONY: all sprx info clean
