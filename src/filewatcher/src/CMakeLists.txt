# File watcher executable

add_executable(filewatcher
    filewatcher.cpp
    watcher_core.cpp
)

# Performance optimizations - inherit from parent CMakeLists.txt
target_compile_options(filewatcher PRIVATE -fno-exceptions -fno-rtti)

# Install binary
install(TARGETS filewatcher
    RUNTIME DESTINATION bin
)