#import <CoreBluetooth/CoreBluetooth.h>
#import <Foundation/Foundation.h>
#import <sys/stat.h>
#import <unistd.h>

static CBUUID *uuid(NSString *suffix) {
    return [CBUUID UUIDWithString:[@"6DC5AB91-5768-46D4-B180-06AB8725" stringByAppendingString:suffix]];
}

static void report(NSString *value) {
    puts(value.UTF8String);
    fflush(stdout);
}

@interface PhoneLink : NSObject <CBPeripheralManagerDelegate>
@property CBPeripheralManager *manager;
@property CBMutableCharacteristic *event;
@property CBMutableCharacteristic *pair;
@property NSURL *peerFile;
@property NSString *peer;
@property NSString *code;
@property NSDate *expires;
@property NSInteger attempts;
@property NSMutableArray<NSData *> *pending;
@end

@implementation PhoneLink
- (CBCentral *)receiver {
    for (CBCentral *central in self.event.subscribedCentrals) {
        if ([central.identifier.UUIDString isEqualToString:self.peer]) return central;
    }
    return nil;
}

- (void)command:(NSString *)line {
    if ([line hasPrefix:@"pair "] && line.length == 11) {
        self.code = [line substringFromIndex:5];
        self.expires = [NSDate dateWithTimeIntervalSinceNow:300];
        self.attempts = 0;
        return;
    }
    if (![line isEqual:@"completed"] && ![line isEqual:@"attention"]) return;
    if (![self receiver]) return;
    UInt8 value = [line isEqual:@"completed"] ? 1 : 2;
    [self.pending addObject:[NSData dataWithBytes:&value length:1]];
    [self drain];
}

- (void)drain {
    CBCentral *central = [self receiver];
    if (!central) { [self.pending removeAllObjects]; return; }
    while (self.pending.count) {
        if (![self.manager updateValue:self.pending.firstObject forCharacteristic:self.event
                   onSubscribedCentrals:@[central]]) return;
        [self.pending removeObjectAtIndex:0];
    }
}

- (void)peripheralManagerIsReadyToUpdateSubscribers:(CBPeripheralManager *)manager { [self drain]; }

- (void)peripheralManagerDidUpdateState:(CBPeripheralManager *)manager {
    [self.pending removeAllObjects];
    if (manager.state != CBManagerStatePoweredOn) {
        self.event = nil;
        report(manager.state == CBManagerStateUnauthorized ? @"denied" :
               manager.state == CBManagerStateUnsupported ? @"unsupported" : @"off");
        return;
    }
    self.pair = [[CBMutableCharacteristic alloc] initWithType:uuid(@"0002")
        properties:CBCharacteristicPropertyWrite value:nil permissions:CBAttributePermissionsWriteEncryptionRequired];
    self.event = [[CBMutableCharacteristic alloc] initWithType:uuid(@"0003")
        properties:CBCharacteristicPropertyIndicate | CBCharacteristicPropertyIndicateEncryptionRequired
        value:nil permissions:0];
    CBMutableService *service = [[CBMutableService alloc] initWithType:uuid(@"0001") primary:YES];
    service.characteristics = @[self.pair, self.event];
    [manager addService:service];
}

- (void)peripheralManager:(CBPeripheralManager *)manager didAddService:(CBService *)service error:(NSError *)error {
    if (error) { report(@"error"); return; }
    [manager startAdvertising:@{CBAdvertisementDataServiceUUIDsKey:@[service.UUID],
                                CBAdvertisementDataLocalNameKey:@"Codex Mac"}];
}

- (void)peripheralManagerDidStartAdvertising:(CBPeripheralManager *)manager error:(NSError *)error {
    report(error ? @"error" : ([self receiver] ? @"connected" : @"waiting"));
}

- (void)peripheralManager:(CBPeripheralManager *)manager didReceiveWriteRequests:(NSArray<CBATTRequest *> *)requests {
    CBATTRequest *r = requests.firstObject;
    NSString *candidate = [[NSString alloc] initWithData:r.value encoding:NSUTF8StringEncoding];
    if (requests.count == 1 && r.offset == 0 && [r.characteristic.UUID isEqual:self.pair.UUID] &&
        [candidate isEqual:@"resume"] && [r.central.identifier.UUIDString isEqualToString:self.peer]) {
        [manager respondToRequest:r withResult:CBATTErrorSuccess];
        return;
    }
    if (requests.count != 1 || ![r.characteristic.UUID isEqual:self.pair.UUID] || r.offset != 0 ||
        !self.code || self.expires.timeIntervalSinceNow <= 0 || self.attempts >= 5) {
        [manager respondToRequest:r withResult:CBATTErrorInsufficientAuthorization];
        return;
    }
    if (![self.code isEqualToString:candidate]) {
        if (++self.attempts == 5) { self.code = nil; report(@"code-ended"); }
        [manager respondToRequest:r withResult:CBATTErrorInsufficientAuthorization];
        return;
    }
    NSString *peer = r.central.identifier.UUIDString;
    if (![peer writeToURL:self.peerFile atomically:YES encoding:NSUTF8StringEncoding error:NULL]) {
        [manager respondToRequest:r withResult:CBATTErrorUnlikelyError];
        return;
    }
    [self.pending removeAllObjects];
    self.peer = peer;
    self.code = nil;
    [manager respondToRequest:r withResult:CBATTErrorSuccess];
    report(@"code-ended");
    report([self receiver] ? @"connected" : @"waiting");
}

- (void)peripheralManager:(CBPeripheralManager *)manager central:(CBCentral *)central
    didSubscribeToCharacteristic:(CBCharacteristic *)characteristic {
    if ([central.identifier.UUIDString isEqualToString:self.peer]) report(@"connected");
}

- (void)peripheralManager:(CBPeripheralManager *)manager central:(CBCentral *)central
    didUnsubscribeFromCharacteristic:(CBCharacteristic *)characteristic {
    if ([central.identifier.UUIDString isEqualToString:self.peer]) {
        [self.pending removeAllObjects];
        report(@"waiting");
    }
}
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 2) return 2;
        umask(0077);
        PhoneLink *link = [PhoneLink new];
        link.peerFile = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]];
        link.peer = [NSString stringWithContentsOfURL:link.peerFile encoding:NSUTF8StringEncoding error:NULL];
        link.pending = [NSMutableArray array];
        link.manager = [[CBPeripheralManager alloc] initWithDelegate:link queue:dispatch_get_main_queue()];
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
            char line[128];
            while (fgets(line, sizeof(line), stdin)) {
                NSString *command = [[NSString stringWithUTF8String:line]
                    stringByTrimmingCharactersInSet:NSCharacterSet.newlineCharacterSet];
                dispatch_async(dispatch_get_main_queue(), ^{ [link command:command]; });
            }
            exit(0);
        });
        [[NSRunLoop mainRunLoop] run];
    }
    return 0;
}
