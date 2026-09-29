#pragma once

#include <whb/log.h>

#define LOG(FMT, ARGS...) WHBLogPrintf("[ReInfinity] " FMT, ##ARGS)

void initLogging();
void deinitLogging();
