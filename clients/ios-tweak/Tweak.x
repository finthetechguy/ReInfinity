#import <Foundation/Foundation.h>

#define LOG_PREFIX @"[ReInfinity]"

// Keep in step with Version in control.
static NSString *const kVersion = @"1.0.0";
static NSString *const kPrefsDomain = @"com.reinfinity.ios";
static NSString *const kPrefsPath = @"/var/mobile/Library/Preferences/com.reinfinity.ios.plist";
static const NSInteger kDefaultPort = 4;

// Requests to these hosts are sent to the server instead.
static NSString *const kRewriteHosts[] = {
    @"api.disney.com",
};

static const char *const kGameBundleIds[] = {
    "com.disney.DisneyInfinity",
};

// Marks our own forwarded request so the protocol doesn't pick it up again.
static NSString *const kHandledKey = @"com.reinfinity.ios.handled";

static NSString *gServerBase = nil;

static BOOL shouldRewriteHost(NSString *host) {
    for (size_t i = 0; i < sizeof(kRewriteHosts) / sizeof(kRewriteHosts[0]); i++) {
        if ([host caseInsensitiveCompare:kRewriteHosts[i]] == NSOrderedSame) return YES;
    }
    return NO;
}

// Keeps everything after the host (path, query and fragment) exactly as the game wrote it.
static NSString *rewriteUrl(NSURL *url) {
    NSString *original = url.absoluteString;
    NSRange scheme = [original rangeOfString:@"://"];
    if (scheme.location == NSNotFound) return nil;

    NSUInteger authorityStart = NSMaxRange(scheme);
    NSRange rest = [original rangeOfCharacterFromSet:[NSCharacterSet characterSetWithCharactersInString:@"/?#"]
                                             options:0
                                               range:NSMakeRange(authorityStart, original.length - authorityStart)];
    NSString *tail = rest.location == NSNotFound ? @"" : [original substringFromIndex:rest.location];
    return [gServerBase stringByAppendingString:tail];
}

// Loads matching requests from the server and hands the response back as if it came from the original URL.
// A URL protocol is a public API, so nothing in the game is modified or it'll crash.
@interface ReInfURLProtocol : NSURLProtocol <NSURLConnectionDataDelegate>
@property (nonatomic, strong) NSURLConnection *connection;
@end

@implementation ReInfURLProtocol

+ (BOOL)canInitWithRequest:(NSURLRequest *)request {
    if ([NSURLProtocol propertyForKey:kHandledKey inRequest:request]) return NO;

    NSString *host = request.URL.host;
    if (!host) return NO;
    if (shouldRewriteHost(host)) return YES;

    if ([host rangeOfString:@"disney" options:NSCaseInsensitiveSearch].location != NSNotFound) {
        NSLog(LOG_PREFIX @" Not rewritten: %@", request.URL.absoluteString);
    }
    return NO;
}

+ (NSURLRequest *)canonicalRequestForRequest:(NSURLRequest *)request {
    return request;
}

- (void)startLoading {
    NSMutableURLRequest *forwarded = [self.request mutableCopy];
    NSString *rewritten = rewriteUrl(forwarded.URL);
    if (!rewritten) {
        [self.client URLProtocol:self didFailWithError:[NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorBadURL userInfo:nil]];
        return;
    }

    forwarded.URL = [NSURL URLWithString:rewritten];
    [NSURLProtocol setProperty:@YES forKey:kHandledKey inRequest:forwarded];
    NSLog(LOG_PREFIX @" %@ %@ -> %@", forwarded.HTTPMethod, self.request.URL.absoluteString, rewritten);

    self.connection = [NSURLConnection connectionWithRequest:forwarded delegate:self];
}

- (void)stopLoading {
    [self.connection cancel];
    self.connection = nil;
}

- (void)connection:(NSURLConnection *)connection didReceiveResponse:(NSURLResponse *)response {
    [self.client URLProtocol:self didReceiveResponse:response cacheStoragePolicy:NSURLCacheStorageNotAllowed];
}

- (void)connection:(NSURLConnection *)connection didReceiveData:(NSData *)data {
    [self.client URLProtocol:self didLoadData:data];
}

- (void)connectionDidFinishLoading:(NSURLConnection *)connection {
    [self.client URLProtocolDidFinishLoading:self];
    self.connection = nil;
}

- (void)connection:(NSURLConnection *)connection didFailWithError:(NSError *)error {
    NSLog(LOG_PREFIX @" %@ failed: %@", self.request.URL.absoluteString, error.localizedDescription);
    [self.client URLProtocol:self didFailWithError:error];
    self.connection = nil;
}

@end

static BOOL isSupportedGame(NSString *bundleId) {
    for (size_t i = 0; i < sizeof(kGameBundleIds) / sizeof(kGameBundleIds[0]); i++) {
        if ([bundleId isEqualToString:@(kGameBundleIds[i])]) return YES;
    }
    return NO;
}

// cfprefsd is a fallback for changes not yet written
static NSDictionary *loadPrefs(NSString **source) {
    NSDictionary *prefs = [NSDictionary dictionaryWithContentsOfFile:kPrefsPath];
    if (prefs) {
        *source = @"file";
        return prefs;
    }

    CFStringRef domain = (__bridge CFStringRef)kPrefsDomain;
    CFArrayRef keys = CFPreferencesCopyKeyList(domain, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
    if (keys && CFArrayGetCount(keys) > 0) {
        prefs = CFBridgingRelease(CFPreferencesCopyMultiple(keys, domain, kCFPreferencesCurrentUser, kCFPreferencesAnyHost));
    }
    if (keys) CFRelease(keys);
    *source = prefs ? @"cfprefsd" : @"none";
    return prefs;
}

static BOOL boolPref(NSDictionary *prefs, NSString *key, BOOL fallback) {
    id value = prefs[key];
    return [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : fallback;
}

// Accepts what people tend to type around the address: a scheme or a trailing slash.
static NSString *normaliseServer(NSString *server) {
    NSRange scheme = [server rangeOfString:@"://"];
    if (scheme.location != NSNotFound) server = [server substringFromIndex:NSMaxRange(scheme)];
    while ([server hasSuffix:@"/"]) server = [server substringToIndex:server.length - 1];

    NSCharacterSet *invalid = [[NSCharacterSet characterSetWithCharactersInString:
        @"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-"] invertedSet];
    if (server.length == 0 || [server rangeOfCharacterFromSet:invalid].location != NSNotFound) return nil;
    return server;
}

static NSInteger portPref(NSDictionary *prefs) {
    id value = prefs[@"port"];
    if (!value) return kDefaultPort;

    NSInteger port = [value respondsToSelector:@selector(integerValue)] ? [value integerValue] : 0;
    if (port < 1 || port > 65535) {
        NSLog(LOG_PREFIX @" Port \"%@\" isn't valid, using %ld", value, (long)kDefaultPort);
        return kDefaultPort;
    }
    return port;
}

%ctor {
    @autoreleasepool {
        NSString *bundleId = [NSBundle mainBundle].bundleIdentifier;
        if (!isSupportedGame(bundleId)) return;

        NSString *source = nil;
        NSDictionary *prefs = loadPrefs(&source);

        if (!boolPref(prefs, @"enabled", YES)) {
            NSLog(LOG_PREFIX @" %@ loaded in %@: disabled in Settings (settings from %@)", kVersion, bundleId, source);
            return;
        }

        id rawServer = prefs[@"server"];
        NSString *trimmed = [rawServer isKindOfClass:[NSString class]]
            ? [rawServer stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]]
            : @"";
        if (trimmed.length == 0) {
            NSLog(LOG_PREFIX @" %@ loaded in %@: no server set in Settings (settings from %@)", kVersion, bundleId, source);
            return;
        }

        NSString *server = normaliseServer(trimmed);
        if (!server) {
            NSLog(LOG_PREFIX @" %@ loaded in %@: server \"%@\" isn't a valid IP address or domain, not redirecting", kVersion, bundleId, trimmed);
            return;
        }

        NSString *scheme = boolPref(prefs, @"https", NO) ? @"https" : @"http";
        gServerBase = [NSString stringWithFormat:@"%@://%@:%ld", scheme, server, (long)portPref(prefs)];

        [NSURLProtocol registerClass:[ReInfURLProtocol class]];
        NSLog(LOG_PREFIX @" %@ loaded in %@, sending requests to %@ (settings from %@)", kVersion, bundleId, gServerBase, source);
    }
}
