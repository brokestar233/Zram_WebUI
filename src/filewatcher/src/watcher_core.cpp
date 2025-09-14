#include "watcher_core.hpp"
#include <sys/inotify.h>
#include <sys/stat.h>
#include <unistd.h>
#include <poll.h>
#include <cstring>
#include <cstdlib>
#include <cstdio>
#include <format>
#include <string_view>
#include <algorithm>
#include <thread>

WatcherCore::WatcherCore() noexcept {
    inotify_fd_ = inotify_init1(IN_NONBLOCK | IN_CLOEXEC);
#ifdef ANDROID_DOZE_AWARE
    setup_doze_protection();
#endif
}

WatcherCore::~WatcherCore() noexcept {
    stop();
    if (inotify_fd_ >= 0) {
        close(inotify_fd_);
    }
#ifdef ANDROID_DOZE_AWARE
    if (wake_fd_ != -1) {
        close(wake_fd_);
    }
#endif
}

bool WatcherCore::add_watch(std::string_view path, std::string_view command, std::uint32_t events) noexcept {
    if (inotify_fd_ < 0) {
        return false;
    }
    
    const int wd = inotify_add_watch(inotify_fd_, path.data(), events);
    if (wd < 0) {
        return false;
    }
    
    watches_.emplace(wd, WatchInfo{std::string{path}, std::string{command}, events});
    return true;
}

void WatcherCore::start() noexcept {
    running_.store(true, std::memory_order_relaxed);
    
    std::array<char, 4096> buffer{};
    struct pollfd pfd = {inotify_fd_, POLLIN, 0};
    
#ifdef ANDROID_DOZE_AWARE
    const int timeout_ms = 2000;
#else
    const int timeout_ms = 1000;
#endif
    
    while (running_.load(std::memory_order_relaxed)) {
        const int poll_result = poll(&pfd, 1, timeout_ms);
        
        if (poll_result > 0 && (pfd.revents & POLLIN)) {
            const ssize_t len = read(inotify_fd_, buffer.data(), buffer.size());
            if (len > 0) {
                process_events(std::string_view{buffer.data(), static_cast<size_t>(len)});
                
                if (one_shot_.load(std::memory_order_relaxed)) {
                    break;
                }
            }
        } else if (poll_result == 0) {
            const int interval = periodic_interval_.load(std::memory_order_relaxed);
            if (interval > 0) {
                periodic_check();
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
    }
}

void WatcherCore::stop() noexcept {
    running_.store(false, std::memory_order_relaxed);
}

void WatcherCore::process_events(std::string_view buffer) noexcept {
    size_t offset = 0;
    
    while (offset < buffer.size()) {
        const auto* event = reinterpret_cast<const struct inotify_event*>(buffer.data() + offset);
        
        if (const auto it = watches_.find(event->wd); it != watches_.end()) {
            execute_command(it->second.command, it->second.path, event);
        }
        
        offset += sizeof(struct inotify_event) + event->len;
    }
}

void WatcherCore::execute_command(std::string_view command, const std::string& path, 
                                 const struct inotify_event* event) noexcept {
    std::string cmd{command};
    
    if (const auto pos = cmd.find("$FILE"); pos != std::string::npos) {
        std::string filename = path;
        if (event && event->len > 0) {
            filename += "/";
            filename += event->name;
        }
        cmd.replace(pos, 5, filename);
    }
    
    if (const pid_t pid = fork(); pid == 0) {
        std::system(cmd.c_str());
        std::exit(0);
    }
}

void WatcherCore::set_periodic_check(int interval_seconds) noexcept {
    periodic_interval_.store(interval_seconds, std::memory_order_relaxed);
}

void WatcherCore::set_one_shot(bool enabled) noexcept {
    one_shot_.store(enabled, std::memory_order_relaxed);
}

void WatcherCore::periodic_check() noexcept {
    for (auto& [wd, watch_info] : watches_) {
        if (file_changed(watch_info.path, watch_info.last_check)) {
            execute_command(watch_info.command, watch_info.path, nullptr);
        }
    }
}

bool WatcherCore::file_changed(const std::string& path, std::chrono::steady_clock::time_point& last_check) noexcept {
    struct stat file_stat;
    const auto now = std::chrono::steady_clock::now();
    
    if (stat(path.c_str(), &file_stat) == 0) {
        if (now - last_check > std::chrono::seconds(periodic_interval_.load(std::memory_order_relaxed))) {
            last_check = now;
            return true;
        }
    }
    
    return false;
}

#ifdef ANDROID_DOZE_AWARE
void WatcherCore::setup_doze_protection() noexcept {
    wake_fd_ = eventfd(0, EFD_CLOEXEC | EFD_NONBLOCK);
}
#endif
