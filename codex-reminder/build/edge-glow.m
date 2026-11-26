#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <fcntl.h>
#import <string.h>
#import <unistd.h>

// A non-activating panel stays above full-screen apps without taking keyboard focus.
@interface EdgePanel : NSPanel
@end
@implementation EdgePanel
- (NSRect)constrainFrameRect:(NSRect)frame toScreen:(NSScreen *)screen { return frame; }
- (BOOL)canBecomeKeyWindow { return NO; }
- (BOOL)canBecomeMainWindow { return NO; }
@end

static CALayer *edgeLight(NSSize size, BOOL attention) {
    CALayer *light = [CALayer layer];
    light.frame = (CGRect){CGPointZero, size};
    CGFloat depth = MIN(84, MIN(size.width, size.height) * 0.085);
    NSColor *base = attention ? [NSColor colorWithSRGBRed:1 green:0.43 blue:0.04 alpha:1]
                              : [NSColor colorWithSRGBRed:0.04 green:0.83 blue:0.32 alpha:1];
    NSColor *rim = attention ? [NSColor colorWithSRGBRed:1 green:0.76 blue:0.22 alpha:1]
                             : [NSColor colorWithSRGBRed:0.54 green:1 blue:0.61 alpha:1];
    NSArray *colors = @[
        (__bridge id)rim.CGColor,
        (__bridge id)base.CGColor,
        (__bridge id)[base colorWithAlphaComponent:0.52].CGColor,
        (__bridge id)[base colorWithAlphaComponent:0].CGColor
    ];
    CGRect strips[] = {
        CGRectMake(0, 0, depth, size.height), CGRectMake(size.width - depth, 0, depth, size.height),
        CGRectMake(0, 0, size.width, depth), CGRectMake(0, size.height - depth, size.width, depth)
    };
    CGPoint starts[] = {{0, 0.5}, {1, 0.5}, {0.5, 0}, {0.5, 1}};
    for (int i = 0; i < 4; ++i) {
        CAGradientLayer *strip = [CAGradientLayer layer];
        strip.frame = strips[i];
        strip.startPoint = starts[i];
        strip.endPoint = CGPointMake(1 - starts[i].x, 1 - starts[i].y);
        strip.colors = colors;
        strip.locations = @[@0, @0.055, @0.32, @1];
        [light addSublayer:strip];
    }
    return light;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        BOOL attention = argc == 2 && strcmp(argv[1], "attention") == 0;
        if (argc > 1 && !attention && (argc != 2 || strcmp(argv[1], "completed") != 0)) return 2;

        // A newer event takes over even when the previous color is still pulsing.
        NSString *path = [NSTemporaryDirectory() stringByAppendingPathComponent:@"icon-app-edge-glow.owner"];
        int ownerFile = open(path.fileSystemRepresentation, O_CREAT | O_RDWR | O_NOFOLLOW, 0600);
        pid_t owner = getpid();
        if (ownerFile < 0 || pwrite(ownerFile, &owner, sizeof(owner), 0) != sizeof(owner)) return 1;

        [NSApplication.sharedApplication setActivationPolicy:NSApplicationActivationPolicyProhibited];
        NSMutableArray<NSPanel *> *panels = [NSMutableArray array];
        CFTimeInterval halfPulse = 0.95;
        NSUInteger cycles = 2;
        for (NSScreen *screen in NSScreen.screens) {
            NSRect frame = screen.frame;
            NSPanel *panel = [[EdgePanel alloc] initWithContentRect:frame
                styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
                backing:NSBackingStoreBuffered defer:NO];
            panel.opaque = NO;
            panel.backgroundColor = NSColor.clearColor;
            panel.hasShadow = NO;
            panel.ignoresMouseEvents = YES;
            panel.hidesOnDeactivate = NO;
            panel.accessibilityElement = NO;
            panel.level = NSScreenSaverWindowLevel;
            panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
                NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorIgnoresCycle;
            [panel setFrame:frame display:NO];
            NSView *view = [[NSView alloc] initWithFrame:(NSRect){NSZeroPoint, frame.size}];
            view.wantsLayer = YES;
            panel.contentView = view;
            CALayer *light = edgeLight(frame.size, attention);
            light.opacity = 0;
            [view.layer addSublayer:light];

            CABasicAnimation *pulse = [CABasicAnimation animationWithKeyPath:@"opacity"];
            pulse.fromValue = @0;
            pulse.toValue = @1;
            pulse.duration = halfPulse;
            pulse.autoreverses = YES;
            pulse.repeatCount = cycles;
            pulse.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
            [light addAnimation:pulse forKey:@"pulse"];
            [panel orderFrontRegardless];
            [panels addObject:panel];
        }
        [CATransaction flush];
        if (panels.count == 0) return 1;
        [NSTimer scheduledTimerWithTimeInterval:halfPulse * 2 * cycles repeats:NO block:^(NSTimer *timer) {
            for (NSPanel *panel in panels) [panel orderOut:nil];
            [NSApp terminate:nil];
        }];
        [NSTimer scheduledTimerWithTimeInterval:0.08 repeats:YES block:^(NSTimer *timer) {
            pid_t current = 0;
            if (pread(ownerFile, &current, sizeof(current), 0) != sizeof(current) || current != owner) {
                [NSApp terminate:nil];
            }
        }];
        [NSApp run];
        close(ownerFile);
    }
    return 0;
}
