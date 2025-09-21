cmake_minimum_required(VERSION 3.16)
project(AuroraCore)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Power-efficient compilation options
option(ANDROID_DOZE_AWARE "Enable Android Doze mode optimizations" ON)
option(POWER_EFFICIENT "Enable power-efficient optimizations" ON)

# Compiler-specific options
if(CMAKE_CXX_COMPILER_ID STREQUAL "GNU" OR CMAKE_CXX_COMPILER_ID STREQUAL "Clang")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wall -Wextra -pthread")
    set(CMAKE_CXX_FLAGS_DEBUG "${CMAKE_CXX_FLAGS_DEBUG} -g -O0")
    
    # Power-efficient release optimizations
    if(POWER_EFFICIENT)
        set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -Os -DNDEBUG -ffunction-sections -fdata-sections")
        set(CMAKE_EXE_LINKER_FLAGS_RELEASE "${CMAKE_EXE_LINKER_FLAGS_RELEASE} -Wl,--gc-sections")
    else()
        set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -O3 -DNDEBUG")
    endif()
    
    # Android-specific optimizations
    if(ANDROID_DOZE_AWARE)
        add_definitions(-DANDROID_DOZE_AWARE)
        set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -DANDROID_DOZE_AWARE")
    endif()
    
elseif(CMAKE_CXX_COMPILER_ID STREQUAL "MSVC")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} /W4")
    if(POWER_EFFICIENT)
        set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} /Os /DNDEBUG")
    endif()
endif()

# Find required packages
find_package(Threads REQUIRED)

# Add subdirectories
add_subdirectory(src)