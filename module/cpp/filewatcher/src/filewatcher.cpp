#include "watcher_core.hpp"
#include <sys/inotify.h>
#include <signal.h>
#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <string_view>
#include <memory>
#include <atomic>
#include <format>

static std::unique_ptr<WatcherCore> g_watcher;

void signal_handler(int sig) noexcept {
    (void)sig;
    if (g_watcher) {
        g_watcher->stop();
    }
}

void print_usage(std::string_view prog_name) noexcept {
    std::printf("Usage: %s [options] <path> <command>\n", prog_name.data());
    std::printf("Options:\n");
    std::printf("  -e <events>  Event mask (default: modify,create,delete)\n");
    std::printf("               Available: modify,create,delete,move,attrib,access\n");
    std::printf("  -p <seconds> Enable periodic check every N seconds (0 to disable)\n");
    std::printf("  -o           One-shot mode: exit after first event detection\n");
    std::printf("  -h           Show this help\n");
    std::printf("\nExamples:\n");
    std::printf("  %s /tmp/test.txt \"echo File changed: $FILE\"\n", prog_name.data());
    std::printf("  %s -e create,delete /tmp/ \"logger_client File event: $FILE\"\n", prog_name.data());
    std::printf("  %s -p 30 /tmp/test.txt \"echo Periodic check: $FILE\"\n", prog_name.data());
    std::printf("  %s -o -p 10 /tmp/test.txt \"echo One-time check: $FILE\"\n", prog_name.data());
}

constexpr std::uint32_t parse_events(std::string_view events_str) noexcept {
    std::uint32_t events = 0;
    
    if (events_str.find("modify") != std::string_view::npos) {
        events |= IN_MODIFY;
    }
    if (events_str.find("create") != std::string_view::npos) {
        events |= IN_CREATE;
    }
    if (events_str.find("delete") != std::string_view::npos) {
        events |= IN_DELETE;
    }
    if (events_str.find("move") != std::string_view::npos) {
        events |= IN_MOVE;
    }
    if (events_str.find("attrib") != std::string_view::npos) {
        events |= IN_ATTRIB;
    }
    if (events_str.find("access") != std::string_view::npos) {
        events |= IN_ACCESS;
    }
    
    return events ? events : (IN_MODIFY | IN_CREATE | IN_DELETE);
}

int main(int argc, char* argv[]) {
    std::string_view path;
    std::string_view command;
    std::uint32_t events = IN_MODIFY | IN_CREATE | IN_DELETE;
    int periodic_interval = 0;
    bool one_shot = false;
    
    for (int i = 1; i < argc; i++) {
        const std::string_view arg{argv[i]};
        if (arg == "-e" && i + 1 < argc) {
            events = parse_events(argv[++i]);
        } else if (arg == "-p" && i + 1 < argc) {
            periodic_interval = std::atoi(argv[++i]);
            if (periodic_interval < 0) {
                std::fprintf(stderr, "Invalid periodic interval: %d\n", periodic_interval);
                return 1;
            }
        } else if (arg == "-o") {
            one_shot = true;
        } else if (arg == "-h") {
            print_usage(argv[0]);
            return 0;
        } else if (path.empty()) {
            path = arg;
        } else if (command.empty()) {
            command = arg;
        }
    }
    
    if (path.empty() || command.empty()) {
        print_usage(argv[0]);
        return 1;
    }
    
    signal(SIGTERM, signal_handler);
    signal(SIGINT, signal_handler);
    
    g_watcher = std::make_unique<WatcherCore>();
    
    if (periodic_interval > 0) {
        g_watcher->set_periodic_check(periodic_interval);
    }
    if (one_shot) {
        g_watcher->set_one_shot(true);
    }
    
    if (!g_watcher->add_watch(path, command, events)) {
        std::fprintf(stderr, "Failed to add watch for: %s\n", path.data());
        return 1;
    }
    
    std::printf("Watching: %s\n", path.data());
    std::printf("Command: %s\n", command.data());
    if (!one_shot) {
        std::printf("Press Ctrl+C to stop\n");
    }
    
    g_watcher->start();
    
    std::printf("File watcher stopped\n");
    return 0;
}