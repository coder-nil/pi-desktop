#import <Cocoa/Cocoa.h>

@interface PiStartupOverlay : NSView
@property(nonatomic, strong) NSImage *image;
@end

@implementation PiStartupOverlay
- (BOOL)isOpaque { return YES; }
- (void)drawRect:(NSRect)dirtyRect {
    [[NSColor whiteColor] setFill];
    NSRectFill(self.bounds);
    CGFloat size = MIN(220, MIN(self.bounds.size.width, self.bounds.size.height) * 0.42);
    NSRect rect = NSMakeRect((self.bounds.size.width-size)/2, (self.bounds.size.height-size)/2, size, size);
    [self.image drawInRect:rect fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1];
}
@end

bool pi_show_startup_overlay(void *rawWindow, const unsigned char *bytes, size_t length) {
    NSWindow *window = (__bridge NSWindow *)rawWindow;
    NSView *content = window.contentView;
    NSImage *image = [[NSImage alloc] initWithData:[NSData dataWithBytes:bytes length:length]];
    if (!content || !image) return false;
    PiStartupOverlay *overlay = [[PiStartupOverlay alloc] initWithFrame:content.bounds];
    overlay.image = image;
    overlay.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [content addSubview:overlay positioned:NSWindowAbove relativeTo:nil];
    [overlay display];
    return true;
}

void pi_hide_startup_overlay(void *rawWindow) {
    NSWindow *window = (__bridge NSWindow *)rawWindow;
    for (NSView *view in [window.contentView.subviews copy]) {
        if ([view isKindOfClass:[PiStartupOverlay class]]) [view removeFromSuperview];
    }
}

void pi_raise_startup_overlay(void *rawWindow) {
    NSWindow *window = (__bridge NSWindow *)rawWindow;
    for (NSView *view in [window.contentView.subviews copy]) {
        if ([view isKindOfClass:[PiStartupOverlay class]]) {
            [window.contentView addSubview:view positioned:NSWindowAbove relativeTo:nil];
        }
    }
}
