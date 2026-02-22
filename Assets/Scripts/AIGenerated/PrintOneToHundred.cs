using UnityEngine;

public class PrintOneToHundred : MonoBehaviour
{
    private void Start()
    {
        for (int i = 1; i <= 100; i++)
        {
            Debug.Log(i);
        }
    }
}
