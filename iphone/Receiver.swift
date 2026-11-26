import CoreBluetooth
import SwiftUI
import UserNotifications

private let serviceID = CBUUID(string: "6DC5AB91-5768-46D4-B180-06AB87250001")
private let pairingID = CBUUID(string: "6DC5AB91-5768-46D4-B180-06AB87250002")
private let eventID = CBUUID(string: "6DC5AB91-5768-46D4-B180-06AB87250003")

final class Receiver: NSObject, ObservableObject, CBCentralManagerDelegate, CBPeripheralDelegate, UNUserNotificationCenterDelegate {
    @Published var status = "打开 Mac 上的 iPhone 蓝牙提醒后开始配对。"
    @Published var devices: [CBPeripheral] = []
    @Published var notificationStatus = ""
    @Published var searching = false
    private var manager: CBCentralManager!
    private var device: CBPeripheral?
    private var code: String?
    private var indicator: CBCharacteristic?
    private var savedID: UUID? {
        UserDefaults.standard.string(forKey: "pairedMac").flatMap(UUID.init(uuidString:))
    }

    override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
        manager = CBCentralManager(delegate: self, queue: .main, options: [
            CBCentralManagerOptionRestoreIdentifierKey: "icon-app.reminder.central"
        ])
    }

    func authorizeNotifications() {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { allowed, _ in
            DispatchQueue.main.async {
                self.notificationStatus = allowed ? "已允许通知" : "请在 iPhone 设置中允许通知并打开横幅。"
            }
        }
    }

    func findMac() {
        guard manager.state == .poweredOn else { status = "请打开蓝牙并允许此 App 使用蓝牙。"; return }
        searching = true
        if let previous = device {
            device = nil
            manager.cancelPeripheralConnection(previous)
        }
        code = nil
        devices = []
        manager.scanForPeripherals(withServices: [serviceID])
        status = "选择你的 Mac，再输入 Mac 显示的六位配对码。"
    }

    func pair(_ mac: CBPeripheral, code: String) {
        guard code.utf8.count == 6 && code.allSatisfy({ $0.isASCII && $0.isNumber }) else {
            status = "请输入六位数字配对码。"
            return
        }
        self.code = code
        searching = false
        devices = []
        manager.stopScan()
        connect(mac)
    }

    private func connect(_ mac: CBPeripheral) {
        device = mac
        mac.delegate = self
        indicator = nil
        if mac.state == .connected {
            mac.discoverServices([serviceID])
        } else {
            status = "正在连接 Mac…"
            manager.connect(mac)
        }
    }

    private func reconnect() {
        guard !searching, manager.state == .poweredOn, let id = savedID else { return }
        if let mac = manager.retrievePeripherals(withIdentifiers: [id]).first {
            connect(mac)
        } else {
            manager.scanForPeripherals(withServices: [serviceID])
        }
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn {
            if searching { central.scanForPeripherals(withServices: [serviceID]) }
            else if device == nil { reconnect() }
        } else {
            device = nil
            indicator = nil
            status = central.state == .unauthorized ? "请在设置中允许蓝牙访问。" : "等待蓝牙开启。"
        }
    }

    func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        let restored = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral] ?? []
        for mac in restored {
            if mac.identifier == savedID {
                device = mac
                mac.delegate = self
                if mac.state == .connected { mac.discoverServices([serviceID]) }
                else if mac.state == .disconnected { device = nil }
            } else { central.cancelPeripheralConnection(mac) }
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover mac: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        if searching {
            if !devices.contains(where: { $0.identifier == mac.identifier }) { devices.append(mac) }
        } else if mac.identifier == savedID {
            central.stopScan()
            connect(mac)
        }
    }

    func centralManager(_ central: CBCentralManager, didConnect mac: CBPeripheral) {
        guard device === mac else { return }
        mac.delegate = self
        mac.discoverServices([serviceID])
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral mac: CBPeripheral, error: Error?) {
        guard device === mac else { return }
        device = nil
        indicator = nil
        code = nil
        status = "已断开，等待 Mac 回到附近。"
        if !searching, manager.state == .poweredOn, savedID != nil {
            manager.scanForPeripherals(withServices: [serviceID])
        }
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect mac: CBPeripheral, error: Error?) {
        guard device === mac else { return }
        device = nil
        status = "连接失败，请检查 Mac 蓝牙和提醒开关。"
        if mac.identifier == savedID {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                if self.device == nil { self.reconnect() }
            }
        }
    }

    private func fail(_ text: String, mac: CBPeripheral) {
        code = nil
        device = nil
        status = text
        manager.cancelPeripheralConnection(mac)
    }

    private func serviceUnavailable(on mac: CBPeripheral) {
        guard mac.identifier == savedID, code == nil else {
            return fail("Mac 提醒服务不可用，请重新配对。", mac: mac)
        }
        // The Mac can remain in radio range while its helper restarts.
        // Resume discovery after disconnect so we only reconnect once it advertises again.
        indicator = nil
        mac.delegate = nil
        status = "正在等待已配对的 Mac 重新开启提醒。"
        manager.cancelPeripheralConnection(mac)
    }

    func peripheral(_ mac: CBPeripheral, didDiscoverServices error: Error?) {
        guard device === mac else { return }
        guard error == nil, let service = mac.services?.first(where: { $0.uuid == serviceID }) else {
            return serviceUnavailable(on: mac)
        }
        mac.discoverCharacteristics([pairingID, eventID], for: service)
    }

    func peripheral(_ mac: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard device === mac else { return }
        indicator = service.characteristics?.first { $0.uuid == eventID }
        guard error == nil, indicator != nil,
              let pairing = service.characteristics?.first(where: { $0.uuid == pairingID }) else {
            return serviceUnavailable(on: mac)
        }
        mac.writeValue(Data((code ?? "resume").utf8), for: pairing, type: .withResponse)
    }

    func peripheral(_ mac: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        guard device === mac, characteristic.uuid == pairingID else { return }
        if let error {
            let message: String
            if let attError = error as? CBATTError, attError.code == .insufficientAuthorization {
                message = "Mac 未接受这次配对。请在这台 Mac 上生成新码，再点「查找 Mac」重新配对。"
            } else {
                message = "蓝牙写入失败：\(error.localizedDescription) 请点「查找 Mac」重试。如果系统显示配对数字，请在两端核对并确认。"
            }
            return fail(message, mac: mac)
        }
        guard let indicator else { return fail("无法读取 Mac 提醒服务。", mac: mac) }
        code = nil
        UserDefaults.standard.set(mac.identifier.uuidString, forKey: "pairedMac")
        mac.setNotifyValue(true, for: indicator)
    }

    func peripheral(_ mac: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard device === mac, characteristic.uuid == eventID else { return }
        status = characteristic.isNotifying && error == nil ? "已连接，可以切换到其他 App。" : "订阅提醒失败，请重新连接。"
    }

    func peripheral(_ mac: CBPeripheral, didModifyServices invalidatedServices: [CBService]) {
        if device === mac && invalidatedServices.contains(where: { $0.uuid == serviceID }) {
            if mac.identifier == savedID, code == nil {
                serviceUnavailable(on: mac)
            } else {
                mac.discoverServices([serviceID])
            }
        }
    }

    func peripheral(_ mac: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard device === mac, mac.identifier == savedID, error == nil,
              characteristic.uuid == eventID, let data = characteristic.value, data.count == 1,
              let value = data.first, value == 1 || value == 2 else { return }
        let content = UNMutableNotificationContent()
        content.title = "Codex"
        content.body = value == 1 ? "🟢 已就绪" : "🟠 等待你的输入或授权"
        content.sound = value == 1 ? UNNotificationSound(named: UNNotificationSoundName("attention.wav")) : .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString,
                                                                      content: content, trigger: nil))
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    let receiver = Receiver()
}

@main
struct NearbyReminders: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate
    var body: some Scene { WindowGroup { ReceiverView(receiver: delegate.receiver) } }
}

struct ReceiverView: View {
    @ObservedObject var receiver: Receiver
    @State private var code = ""
    var body: some View {
        NavigationStack {
            Form {
                Section("通知") {
                    Button("允许通知", action: receiver.authorizeNotifications)
                    if !receiver.notificationStatus.isEmpty { Text(receiver.notificationStatus) }
                }
                Section("附近的 Mac") {
                    Text(receiver.status)
                    Button("查找 Mac", action: receiver.findMac)
                    if receiver.searching {
                        TextField("Mac 上的六位配对码", text: $code).keyboardType(.numberPad)
                        ForEach(receiver.devices, id: \.identifier) { mac in
                            Button(mac.name ?? "附近的 Mac") { receiver.pair(mac, code: code); code = "" }
                                .disabled(code.count != 6)
                        }
                    }
                }
            }.navigationTitle("Codex 提醒")
        }
    }
}
