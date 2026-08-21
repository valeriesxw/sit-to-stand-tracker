import cv2
import math
import time
import mediapipe as mp

from mediapipe.tasks import python
from mediapipe.tasks.python import vision


TEST_DURATION = 30
SITTING_ANGLE = 110
STANDING_ANGLE = 160
RESTART_HOLD_SECONDS = 2.0


def calculate_angle(hip, knee, ankle):
    angle1 = math.atan2(
        hip.y - knee.y,
        hip.x - knee.x
    )

    angle2 = math.atan2(
        ankle.y - knee.y,
        ankle.x - knee.x
    )

    angle = abs(math.degrees(angle1 - angle2))

    if angle > 180:
        angle = 360 - angle

    return angle


def draw_panel(
    frame,
    count,
    stage,
    knee_angle,
    time_left,
    body_detected,
    test_complete,
    hand_raised,
    restart_progress,
    waiting_for_hand_down
):
    panel_width = min(360, frame.shape[1])

    overlay = frame.copy()

    cv2.rectangle(
        overlay,
        (0, 0),
        (panel_width, frame.shape[0]),
        (25, 45, 80),
        -1
    )

    cv2.addWeighted(
        overlay,
        0.88,
        frame,
        0.12,
        0,
        frame
    )

    cv2.putText(
        frame,
        "SIT-TO-STAND",
        (25, 45),
        cv2.FONT_HERSHEY_DUPLEX,
        0.9,
        (255, 255, 255),
        2
    )

    cv2.putText(
        frame,
        "TRACKER",
        (25, 80),
        cv2.FONT_HERSHEY_DUPLEX,
        0.9,
        (80, 220, 255),
        2
    )

    cv2.line(
        frame,
        (25, 100),
        (panel_width - 25, 100),
        (100, 140, 180),
        2
    )

    cv2.putText(
        frame,
        "TIME",
        (25, 145),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        (180, 200, 220),
        2
    )

    cv2.putText(
        frame,
        f"00:{time_left:02d}",
        (165, 150),
        cv2.FONT_HERSHEY_DUPLEX,
        1.2,
        (255, 255, 255),
        2
    )

    cv2.putText(
        frame,
        "COUNT",
        (25, 205),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        (180, 200, 220),
        2
    )

    cv2.putText(
        frame,
        str(count),
        (165, 220),
        cv2.FONT_HERSHEY_DUPLEX,
        1.8,
        (80, 220, 255),
        3
    )

    cv2.putText(
        frame,
        "STATUS",
        (25, 275),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        (180, 200, 220),
        2
    )

    if stage == "sitting":
        status_colour = (50, 180, 255)
    elif stage == "standing":
        status_colour = (80, 230, 120)
    else:
        status_colour = (80, 220, 255)

    cv2.putText(
        frame,
        stage.upper(),
        (150, 280),
        cv2.FONT_HERSHEY_DUPLEX,
        0.8,
        status_colour,
        2
    )

    cv2.putText(
        frame,
        "KNEE ANGLE",
        (25, 335),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        (180, 200, 220),
        2
    )

    if knee_angle is None:
        angle_text = "--"
    else:
        angle_text = f"{int(knee_angle)} deg"

    cv2.putText(
        frame,
        angle_text,
        (185, 340),
        cv2.FONT_HERSHEY_DUPLEX,
        0.8,
        (255, 255, 255),
        2
    )

    if body_detected:
        detection_text = "BODY DETECTED"
        detection_colour = (80, 230, 120)
    else:
        detection_text = "MOVE INTO CAMERA VIEW"
        detection_colour = (80, 180, 255)

    cv2.putText(
        frame,
        detection_text,
        (25, 390),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        detection_colour,
        2
    )

    if waiting_for_hand_down:
        gesture_text = "LOWER HAND TO START"
        gesture_colour = (80, 180, 255)
    elif hand_raised:
        gesture_text = "HOLD HAND UP TO RESTART"
        gesture_colour = (80, 220, 255)
    else:
        gesture_text = "RAISE HAND TO RESTART"
        gesture_colour = (180, 200, 220)

    cv2.putText(
        frame,
        gesture_text,
        (25, 430),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.48,
        gesture_colour,
        1
    )

    bar_x = 25
    bar_y = 448
    bar_width = panel_width - 50
    bar_height = 16

    cv2.rectangle(
        frame,
        (bar_x, bar_y),
        (bar_x + bar_width, bar_y + bar_height),
        (80, 100, 125),
        2
    )

    filled_width = int(bar_width * restart_progress)

    if filled_width > 0:
        cv2.rectangle(
            frame,
            (bar_x, bar_y),
            (bar_x + filled_width, bar_y + bar_height),
            (80, 220, 255),
            -1
        )

    if test_complete:
        cv2.rectangle(
            frame,
            (20, 480),
            (panel_width - 20, 535),
            (40, 80, 160),
            -1
        )

        cv2.putText(
            frame,
            "TEST COMPLETE",
            (45, 517),
            cv2.FONT_HERSHEY_DUPLEX,
            0.85,
            (255, 255, 255),
            2
        )

    cv2.putText(
        frame,
        "R: Restart    Q: Quit",
        (25, frame.shape[0] - 25),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.5,
        (210, 220, 230),
        1
    )


base_options = python.BaseOptions(
    model_asset_path="pose_landmarker.task"
)

options = vision.PoseLandmarkerOptions(
    base_options=base_options,
    running_mode=vision.RunningMode.VIDEO
)

landmarker = vision.PoseLandmarker.create_from_options(
    options
)

camera = cv2.VideoCapture(0)

if not camera.isOpened():
    print("Could not open the camera")
    landmarker.close()
    raise SystemExit


count = 0
stage = "ready"
knee_angle = None

test_start_time = None
test_complete = False

last_timestamp_ms = 0

hand_raised = False
hand_raise_start = None
restart_progress = 0.0
restart_armed = True

waiting_for_hand_down = False


while True:
    success, frame = camera.read()

    if not success:
        print("Could not read the camera")
        break

    frame = cv2.flip(frame, 1)

    rgb_frame = cv2.cvtColor(
        frame,
        cv2.COLOR_BGR2RGB
    )

    mp_image = mp.Image(
        image_format=mp.ImageFormat.SRGB,
        data=rgb_frame
    )

    timestamp_ms = int(time.monotonic() * 1000)

    if timestamp_ms <= last_timestamp_ms:
        timestamp_ms = last_timestamp_ms + 1

    last_timestamp_ms = timestamp_ms

    result = landmarker.detect_for_video(
        mp_image,
        timestamp_ms
    )

    body_detected = bool(result.pose_landmarks)
    current_time = time.monotonic()

    if body_detected:
        landmarks = result.pose_landmarks[0]

        nose = landmarks[0]
        left_wrist = landmarks[15]
        right_wrist = landmarks[16]

        left_hand_up = (
            left_wrist.visibility > 0.5
            and left_wrist.y < nose.y
        )

        right_hand_up = (
            right_wrist.visibility > 0.5
            and right_wrist.y < nose.y
        )

        hand_raised = left_hand_up or right_hand_up

        if hand_raised and restart_armed:
            if hand_raise_start is None:
                hand_raise_start = current_time

            held_time = current_time - hand_raise_start

            restart_progress = min(
                1.0,
                held_time / RESTART_HOLD_SECONDS
            )

            if held_time >= RESTART_HOLD_SECONDS:
                count = 0
                stage = "ready"
                knee_angle = None
                test_start_time = None
                test_complete = False

                restart_armed = False
                waiting_for_hand_down = True

                hand_raise_start = None
                restart_progress = 0.0

        elif not hand_raised:
            hand_raise_start = None
            restart_progress = 0.0
            restart_armed = True

            if waiting_for_hand_down:
                waiting_for_hand_down = False

        left_hip = landmarks[23]
        left_knee = landmarks[25]
        left_ankle = landmarks[27]

        knee_angle = calculate_angle(
            left_hip,
            left_knee,
            left_ankle
        )

        if (
            not waiting_for_hand_down
            and not hand_raised
            and test_start_time is None
        ):
            test_start_time = current_time

            if knee_angle < SITTING_ANGLE:
                stage = "sitting"
            else:
                stage = "standing"

        if (
            test_start_time is not None
            and not test_complete
            and not hand_raised
            and not waiting_for_hand_down
        ):
            if knee_angle < SITTING_ANGLE:
                stage = "sitting"

            elif (
                knee_angle > STANDING_ANGLE
                and stage == "sitting"
            ):
                stage = "standing"
                count += 1

        height, width, _ = frame.shape

        for landmark in landmarks:
            x = int(landmark.x * width)
            y = int(landmark.y * height)

            cv2.circle(
                frame,
                (x, y),
                4,
                (70, 255, 120),
                -1
            )

    else:
        knee_angle = None
        hand_raised = False
        hand_raise_start = None
        restart_progress = 0.0

    if test_start_time is None:
        time_left = TEST_DURATION
    else:
        elapsed_time = current_time - test_start_time

        time_left = max(
            0,
            TEST_DURATION - int(elapsed_time)
        )

        if elapsed_time >= TEST_DURATION:
            test_complete = True
            time_left = 0

    draw_panel(
        frame,
        count,
        stage,
        knee_angle,
        time_left,
        body_detected,
        test_complete,
        hand_raised,
        restart_progress,
        waiting_for_hand_down
    )

    cv2.imshow(
        "Sit-to-Stand Tracker",
        frame
    )

    key = cv2.waitKey(1) & 0xFF

    if key == ord("q"):
        break

    if key == ord("r"):
        count = 0
        stage = "ready"
        knee_angle = None
        test_start_time = None
        test_complete = False

        hand_raise_start = None
        restart_progress = 0.0

        waiting_for_hand_down = hand_raised


camera.release()
cv2.destroyAllWindows()
landmarker.close()
