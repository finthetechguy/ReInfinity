#import <Foundation/Foundation.h>

#define LOG_PREFIX @"[ReInfinity]"

static NSString *const kVersion = @"0.1.1";

// hard-coded server, to be replaced by the Settings app values.
static NSString *const kServerBase = @"http://192.168.0.101:4";

// Requests to these hosts are sent to the server instead.
static NSString *const kRewriteHosts[] = {
    @"api.disney.com",
};

static const char *const kGameBundleIds[] = {
    "com.disney.DisneyInfinity",
};

// Marks our own forwarded request so the protocol doesn't pick it up again.
static NSString *const kHandledKey = @"com.reinfinity.ios.handled";

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
    return [kServerBase stringByAppendingString:tail];
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

%ctor {
    @autoreleasepool {
        NSString *bundleId = [NSBundle mainBundle].bundleIdentifier;
        BOOL supported = NO;
        for (size_t i = 0; i < sizeof(kGameBundleIds) / sizeof(kGameBundleIds[0]); i++) {
            if ([bundleId isEqualToString:@(kGameBundleIds[i])]) {
                supported = YES;
                break;
            }
        }
        if (!supported) return;

        [NSURLProtocol registerClass:[ReInfURLProtocol class]];
        NSLog(LOG_PREFIX @" %@ loaded in %@, sending requests to %@", kVersion, bundleId, kServerBase);
    }
}
