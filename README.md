LampLauncher replaces the stock launcher on an Android TV box (such as the Walmart Onn box) and enables the TV to function as a "virtual window" that turns on and off with a single button press. The purpose is to bring virtual morning sunlight (and nature scenes) into dark winter mornings without the annoyances of having to navigate through a clunky TV interface each morning to find livestreams.

<img width="640" height="360" alt="image-1794965526690" src="https://github.com/user-attachments/assets/2f46f58e-1d2b-4511-9e60-51cd7a092abd" />

I have migraine issues so being blasted with direct light from a SAD lamp does not work very well for me. Instead I bounce a SAD lamp off a wall to brighten the whole room indirectly, and then use an 86" TV with the brightness turned all the way up running a live nature camera in the mornings. This actually seems to work pretty well for me.

I think the purpose is both to get photons into the eyeballs, but also to act as a virtual window into nature as both things have separate but related benefits. To fully achieve the benefits of the virtual window, I recommend selecting a stream that does not pan around (stationary camera) and also turn your volume up (even just a tiny bit) so you are getting a little quiet background noise from the scene as well as the picture. The sound helps trick the brain into thinking the nature is real.

I was originally going to design this for Raspberry Pi before I realized how crazy expensive Raspberry Pis have gotten. The Android TV boxes get the job done and are much more affordable, plus they come with a remote.

Please understand this was entirely vibe-coded by Claude and so there is a chance you could brick your Android box; for this reason I would recommend using a cheap external box. Most livestreams are fairly compressed anyway so you are unlikely to gain much video quality going with an expensive box.

To make the one-click on/off work, you must enable CEC on your TV on the HDMI port that you connect the Android box to.

One compromise I have made: the launcher uses the official YouTube app to view the live streams. The launcher itself is basically just a fancy shortcut page that launches the YouTube app to specific streams. The reason is that this is the only "official" way to get top quality video reliably. The two main drawbacks of this approach: sometimes ads will play (but it is rarely on the live cameras I have found-- and you could prob get around this by being a paid subscriber to YouTube if it really bothered you), and pressing Back on the remote returns to YouTube home rather than to the launcher. So press Home rather than back if you want to switch cameras.

To install the launcher, you can first install it as an app to test it out. Then switch the launcher to eliminate extra button presses. I just used the Launcher Manager TV ADB Tools app to do this which was very easy. There is also a slightly more complicated way to do it using ADB from a laptop. There are many guides out there on how to change the launcher on an Android TV so I won't reinvent the wheel here.

It is still possible to access the other apps on the TV from this launcher but tbh I have not tested that much, I do not really watch TV and basically only bought a TV for the purpose of this app. But it seems like the other apps remain accessible from what I can tell.

If you want more info, check out the Claude-README.md which is Claude's very verbose version of this.
