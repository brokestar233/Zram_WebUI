#pragma once
#include <string>
#include <string_view>
#include <unordered_map>
#include <cstdint>
#include <chrono>
#include <atomic>
#include <memory>
#include <sys/stat.h>
#ifdef ANDROID_DOZE_AWARE
#include <sys/eventfd.h>
#include <android/log.h>
#endif

struct inotify_event;

struct WatchInfo {
    std::string path;
    std::string command;
    std::uint32_t events;
    std::chrono::steady_clock::time_point last_check;
    
    WatchInfo() = default;
    WatchInfo(std::string p, std::string cmd, std::uint32_t ev) noexcept
        : path(std::move(p)), command(std::move(cmd)), events(ev), 
          last_check(std::chrono::steady_clock::now()) {}
};

class WatcherCore final {
public:
    WatcherCore() noexcept;
    ~WatcherCore() noexcept;
    
    WatcherCore(const WatcherCore&) = delete;
    WatcherCore& operator=(const WatcherCore&) = delete;
    WatcherCore(WatcherCore&&) = delete;
    WatcherCore& operator=(WatcherCore&&) = delete;
    
    bool add_watch(std::string_view path, std::string_view command, std::uint32_t events) noexcept;
    
    void start() noexcept;
    void stop() noexcept;
    
    void set_periodic_check(int interval_seconds) noexcept;
    void set_one_shot(bool enabled) noexcept;
    
private:
    void process_events(std::string_view buffer) noexcept;
    void execute_command(std::string_view command, const std::string& path, 
                        const struct inotify_event* event) noexcept;
    void periodic_check() noexcept;
    bool file_changed(const std::string& path, std::chrono::steady_clock::time_point& last_check) noexcept;
    
#ifdef ANDROID_DOZE_AWARE
    void setup_doze_protection() noexcept;
    int wake_fd_ = -1;
#endif
    
    int inotify_fd_ = -1;
    std::atomic<bool> running_{false};
    std::atomic<bool> one_shot_{false};
    std::atomic<int> periodic_interval_{0};
    std::unordered_map<int, WatchInfo> watches_;
};