# armv7 as Disney Infinity 1.0 and 2.0 are 32-bit
TARGET := iphone:clang:9.3:6.0
ARCHS := armv7

include $(THEOS)/makefiles/common.mk

TWEAK_NAME = ReInfinity

ReInfinity_FILES = Tweak.x
ReInfinity_CFLAGS = -fobjc-arc
ReInfinity_FRAMEWORKS = Foundation

include $(THEOS_MAKE_PATH)/tweak.mk
