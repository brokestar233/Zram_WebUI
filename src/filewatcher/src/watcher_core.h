#pragma once
#include <string>
#include <unordered_map>
#include <cstdint>
#include <chrono>

struct inotify_event;

struct WatchInfo {
    std::string path;
    std::string command;
    uint32_t events;
    std::chrono::steady_clock::time_point last_check;
};

class WatcherCore {
public:
    WatcherCore();
    ~WatcherCore();
    
    // Add a file/directory to watch
    bool add_watch(const std::string& path, const std::string& command, uint32_t events);
    
    // Start watching (blocking)
    void start();
    
    // Stop watching
    void stop();
    
    // Set periodic check interval (in seconds, 0 to disable)
    void set_periodic_check(int interval_seconds);
    
    // Set one-shot mode (exit after first event)
    void set_one_shot(bool enabled);
    
private:
    void process_events(const char* buffer, ssize_t len);
    void execute_command(const std::string& command, const std::string& path, 
                        const struct inotify_event* event);
    void periodic_check();
    bool file_changed(const std::string& path, std::chrono::steady_clock::time_point& last_check);
    
    int inotify_fd_;
    bool running_;
    bool one_shot_;
    int periodic_interval_;
    std::unordered_map<int, WatchInfo> watches_;
};